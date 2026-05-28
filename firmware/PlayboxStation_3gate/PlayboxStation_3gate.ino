// =============================================================================
// Playbox Station — Phase 1 firmware (3 glass doors, solenoid + gas strut)
// =============================================================================
// Hardware:
//   - ESP32 WROOM-32 (board: "NodeMCU-32S")
//   - 3x 12V solenoid latches driven via a TLS Robotik 4-channel optocoupler
//     relay module (active-LOW). ESP32 GPIO → relay IN; relay NO/COM switches
//     +12V into the solenoid coil. Flyback is handled inside the relay module.
//       Door 1: GPIO 13 → IN1
//       Door 2: GPIO 12 → IN2
//       Door 3: GPIO 14 → IN3
//   - 3x reed switches (Door 1: GPIO 18, Door 2: GPIO 19, Door 3: GPIO 21)
//     Wired between GPIO and GND; INPUT_PULLUP. LOW = magnet near (door closed).
//     OPTIONAL during bench bring-up — without reeds the gate auto-locks on
//     UNLOCKED_TIMEOUT_MS and the RETURN path can't transition. Wire them
//     before soft-launch.
//   - Onboard LED on GPIO 2 (heartbeat blink)
//
// Mechanical model:
//   Door is held closed by a spring-loaded mechanical latch on the solenoid.
//   The gas strut continuously pushes the door OPEN; the latch is the only
//   thing holding it shut. To open: pulse the solenoid ~300ms — latch retracts,
//   gas strut swings the door out. To close: user pushes door, latch auto-
//   engages on the way back. Firmware never has to drive a "close" — gravity +
//   strut + mechanical latch do everything.
//
// State machine (per gate, independent):
//   LOCKED  --(unlock cmd)--------->  UNLOCKED   (pulse solenoid, door pops)
//   UNLOCKED  --(reed: closed)----->  IN_USE     (user took item, closed door)
//   IN_USE  --(return_unlock cmd)->   RETURN_UNLOCKED (pulse solenoid, door pops)
//   RETURN_UNLOCKED --(reed: closed)->LOCKED     (user returned item, emits gate_closed)
//
// Reliability + security features (carries over from v0.3):
//   - 30s task watchdog (panic-reboot if loop wedges)
//   - State timeouts per gate
//   - NVS persistence per gate (state + session + lastTs)
//   - HMAC-SHA256 auth on every BLE command
//   - Monotonic-ts replay protection (single counter, all gates share it)
//
// Wire format matches lib/ble/protocol.ts in the Playbox app.
// =============================================================================

#include <NimBLEDevice.h>
#include <ArduinoJson.h>
#include <Preferences.h>
#include "esp_task_wdt.h"
#include "mbedtls/md.h"

// ---- Pins -------------------------------------------------------------------
#define LED_PIN     2
#define NUM_GATES   3

// Pin assignments: solenoids on safe output pins, reed switches on strap-safe
// input pins. Pick GPIOs that don't double as boot-mode straps to avoid
// boot loops if a solenoid is energised at reset.
static const uint8_t SOLENOID_PINS[NUM_GATES] = { 13, 12, 14 };
static const uint8_t REED_PINS[NUM_GATES]     = { 18, 19, 21 };

// ---- Relay polarity ---------------------------------------------------------
// TLS Robotik 4-channel module is ACTIVE-LOW (LOW on IN energises the relay,
// closing NO→COM and powering the solenoid). HIGH on IN means relay off,
// solenoid de-energised, latch holds the door closed.
#define RELAY_ACTIVE   LOW
#define RELAY_INACTIVE HIGH

// ---- Timing -----------------------------------------------------------------
// 300ms is a safe pulse for most 12V door-latch solenoids. Some need 500ms;
// bump if your latch doesn't reliably retract.
#define SOLENOID_PULSE_MS            300UL
#define UNLOCKED_TIMEOUT_MS          300000UL // door open, user didn't take ball (5min — bench-friendly until reeds are wired)
#define RETURN_UNLOCKED_TIMEOUT_MS   60000UL  // door open, user didn't return ball
#define WDT_TIMEOUT_S                30
#define DEFAULT_DURATION_MIN         30
#define REED_DEBOUNCE_MS             50

// ---- BLE UUIDs (must match lib/ble/protocol.ts) -----------------------------
#define SERVICE_UUID     "12345678-1234-5678-1234-56789abcdef0"
#define UNLOCK_CHAR_UUID "12345678-1234-5678-1234-56789abcdef1"
#define EVENTS_CHAR_UUID "12345678-1234-5678-1234-56789abcdef2"
#define INFO_CHAR_UUID   "12345678-1234-5678-1234-56789abcdef3"

// ---- State ------------------------------------------------------------------
enum GateState { LOCKED, UNLOCKED, IN_USE, RETURN_UNLOCKED };

const char* stateName(GateState s) {
  switch (s) {
    case LOCKED:          return "LOCKED";
    case UNLOCKED:        return "UNLOCKED";
    case IN_USE:          return "IN_USE";
    case RETURN_UNLOCKED: return "RETURN_UNLOCKED";
  }
  return "?";
}

// One row of state per gate. Index 0..NUM_GATES-1 maps to user-facing gate
// numbers 1..NUM_GATES (the app sends 1-indexed, we convert at the boundary).
GateState     gateState[NUM_GATES];
String        activeSessionId[NUM_GATES];
uint16_t      durationMin[NUM_GATES];
unsigned long stateEnteredMs[NUM_GATES];
bool          overdueSent[NUM_GATES];

// Non-blocking solenoid pulses: each gate tracks when to drop its pin LOW.
unsigned long solenoidEndMs[NUM_GATES] = { 0 };

// Reed switch debouncing.
int           lastReed[NUM_GATES];
unsigned long lastReedChangeMs[NUM_GATES] = { 0 };

// BLE handle.
NimBLECharacteristic* eventsChar = nullptr;
bool                  bleConnected = false;

// NVS + replay protection.
Preferences prefs;
uint32_t    lastTs = 0;

// ---- Per-station HMAC secret ------------------------------------------------
// Phase 0/1: hardcoded. Must match PLAYBOX_STATION_SECRET_DEV_001 on Supabase.
// Production will provision per-station at first-boot via a one-shot pairing.
static const uint8_t DEV_001_SECRET[32] = {
  0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77,
  0x88, 0x99, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff,
  0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77,
  0x88, 0x99, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff,
};

// ---- Event emitter ---------------------------------------------------------
void emitEvent(JsonDocument& doc) {
  doc["ts"] = (uint32_t)(millis() / 1000);
  String out;
  serializeJson(doc, out);
  Serial.printf("[BLE] notify: %s\n", out.c_str());
  if (eventsChar && bleConnected) {
    eventsChar->setValue((uint8_t*)out.c_str(), out.length());
    eventsChar->notify();
  }
}

void emitBoot() {
  JsonDocument doc;
  doc["event"] = "boot";
  emitEvent(doc);
}

void emitGateClosed(int gateOneIndexed, const String& sessionId) {
  JsonDocument doc;
  doc["event"] = "gate_closed";
  doc["gate"] = gateOneIndexed;
  doc["session_id"] = sessionId;
  emitEvent(doc);
}

void emitGateTimeout(const char* kind, int gateOneIndexed, const String& sessionId) {
  JsonDocument doc;
  doc["event"] = kind;
  doc["gate"] = gateOneIndexed;
  doc["session_id"] = sessionId;
  emitEvent(doc);
}

// ---- NVS persistence -------------------------------------------------------
// Per-gate keys are suffixed with the index (state0, state1, ...). Keep keys
// <=15 chars (NVS limit).
void saveGate(int g) {
  char key[12];
  snprintf(key, sizeof(key), "st%d", g);    prefs.putUChar(key, (uint8_t)gateState[g]);
  snprintf(key, sizeof(key), "sess%d", g);  prefs.putString(key, activeSessionId[g]);
  snprintf(key, sizeof(key), "dur%d", g);   prefs.putUShort(key, durationMin[g]);
  snprintf(key, sizeof(key), "od%d", g);    prefs.putBool(key, overdueSent[g]);
}

void loadAll() {
  char key[12];
  for (int g = 0; g < NUM_GATES; g++) {
    snprintf(key, sizeof(key), "st%d", g);
    gateState[g] = (GateState)prefs.getUChar(key, LOCKED);
    snprintf(key, sizeof(key), "sess%d", g);
    activeSessionId[g] = prefs.getString(key, "");
    snprintf(key, sizeof(key), "dur%d", g);
    durationMin[g] = prefs.getUShort(key, DEFAULT_DURATION_MIN);
    snprintf(key, sizeof(key), "od%d", g);
    overdueSent[g] = prefs.getBool(key, false);
  }
  lastTs = prefs.getUInt("lastTs", 0);
}

void transitionTo(int g, GateState next) {
  Serial.printf("[STATE] gate %d: %s -> %s\n", g + 1, stateName(gateState[g]), stateName(next));
  gateState[g] = next;
  stateEnteredMs[g] = millis();
  if (next == LOCKED) {
    activeSessionId[g] = "";
    durationMin[g]     = DEFAULT_DURATION_MIN;
    overdueSent[g]     = false;
  } else if (next == IN_USE) {
    overdueSent[g] = false;
  }
  saveGate(g);
}

// ---- Solenoid driver (non-blocking) ---------------------------------------
void triggerSolenoid(int g) {
  digitalWrite(SOLENOID_PINS[g], RELAY_ACTIVE);
  solenoidEndMs[g] = millis() + SOLENOID_PULSE_MS;
  Serial.printf("[SOL] gate %d energised for %lums\n", g + 1, SOLENOID_PULSE_MS);
}

void tickSolenoids() {
  for (int g = 0; g < NUM_GATES; g++) {
    if (solenoidEndMs[g] != 0 && millis() >= solenoidEndMs[g]) {
      digitalWrite(SOLENOID_PINS[g], RELAY_INACTIVE);
      solenoidEndMs[g] = 0;
      Serial.printf("[SOL] gate %d released\n", g + 1);
    }
  }
}

// ---- Reed switch polling --------------------------------------------------
void handleGateClose(int g);

void initReeds() {
  for (int g = 0; g < NUM_GATES; g++) {
    pinMode(REED_PINS[g], INPUT_PULLUP);
    lastReed[g] = digitalRead(REED_PINS[g]);
    lastReedChangeMs[g] = millis();
  }
}

void pollReeds() {
  for (int g = 0; g < NUM_GATES; g++) {
    int r = digitalRead(REED_PINS[g]);
    if (r != lastReed[g] && (millis() - lastReedChangeMs[g]) > REED_DEBOUNCE_MS) {
      lastReed[g] = r;
      lastReedChangeMs[g] = millis();
      if (r == LOW) {
        handleGateClose(g);
      } else {
        Serial.printf("[REED] gate %d opened\n", g + 1);
      }
    }
  }
}

void handleGateClose(int g) {
  Serial.printf("[REED] gate %d closed (state %s)\n", g + 1, stateName(gateState[g]));
  if (gateState[g] == UNLOCKED) {
    // User grabbed the ball, closed the door. No event — taking the ball
    // isn't a session end.
    transitionTo(g, IN_USE);
  } else if (gateState[g] == RETURN_UNLOCKED) {
    // User returned the ball, closed the door. Session ends.
    emitGateClosed(g + 1, activeSessionId[g]);
    transitionTo(g, LOCKED);
  } else {
    // LOCKED or IN_USE — door shouldn't be opening anyway. Could log
    // tamper but for now just ignore.
  }
}

// ---- State timeouts --------------------------------------------------------
void checkTimeouts() {
  unsigned long now = millis();
  for (int g = 0; g < NUM_GATES; g++) {
    unsigned long elapsed = now - stateEnteredMs[g];
    if (gateState[g] == UNLOCKED && elapsed > UNLOCKED_TIMEOUT_MS) {
      Serial.printf("[TIMEOUT] gate %d UNLOCKED expired — assuming taken (no reed)\n", g + 1);
      // Door is mechanically held open by the gas strut and there is no
      // firmware "close" action. The historical behavior was to drop back to
      // LOCKED and clear the session, but on bench (no reed switches wired)
      // that path makes the subsequent return_unlock impossible: firmware
      // only accepts return_unlock from IN_USE, and the cleared session_id
      // would mismatch anyway. Assume the user took the ball, surface the
      // timeout event for diagnostics, and keep the session alive so the app
      // can still issue return_unlock.
      emitGateTimeout("unlock_timeout", g + 1, activeSessionId[g]);
      transitionTo(g, IN_USE);
    } else if (gateState[g] == RETURN_UNLOCKED && elapsed > RETURN_UNLOCKED_TIMEOUT_MS) {
      Serial.printf("[TIMEOUT] gate %d RETURN_UNLOCKED expired — reverting to IN_USE\n", g + 1);
      emitGateTimeout("return_timeout", g + 1, activeSessionId[g]);
      transitionTo(g, IN_USE);
    } else if (gateState[g] == IN_USE && !overdueSent[g] && durationMin[g] > 0 &&
               elapsed > (unsigned long)durationMin[g] * 60UL * 1000UL) {
      Serial.printf("[TIMEOUT] gate %d IN_USE exceeded duration — ball_overdue\n", g + 1);
      emitGateTimeout("ball_overdue", g + 1, activeSessionId[g]);
      overdueSent[g] = true;
      saveGate(g);
    }
  }
}

// ---- HMAC verification (per v0.3) ------------------------------------------
static bool computeHmac(const char* msg, size_t msgLen, uint8_t out[32]) {
  mbedtls_md_context_t ctx;
  mbedtls_md_init(&ctx);
  if (mbedtls_md_setup(&ctx, mbedtls_md_info_from_type(MBEDTLS_MD_SHA256), 1) != 0) {
    mbedtls_md_free(&ctx);
    return false;
  }
  bool ok = (mbedtls_md_hmac_starts(&ctx, DEV_001_SECRET, sizeof(DEV_001_SECRET)) == 0)
         && (mbedtls_md_hmac_update(&ctx, (const uint8_t*)msg, msgLen) == 0)
         && (mbedtls_md_hmac_finish(&ctx, out) == 0);
  mbedtls_md_free(&ctx);
  return ok;
}

static int hexNibble(char c) {
  if (c >= '0' && c <= '9') return c - '0';
  if (c >= 'a' && c <= 'f') return c - 'a' + 10;
  if (c >= 'A' && c <= 'F') return c - 'A' + 10;
  return -1;
}

static bool hexToBytes(const String& hex, uint8_t* out, size_t outLen) {
  if (hex.length() != outLen * 2) return false;
  for (size_t i = 0; i < outLen; i++) {
    int hi = hexNibble(hex.charAt(i * 2));
    int lo = hexNibble(hex.charAt(i * 2 + 1));
    if (hi < 0 || lo < 0) return false;
    out[i] = (uint8_t)((hi << 4) | lo);
  }
  return true;
}

static bool ctEqual(const uint8_t* a, const uint8_t* b, size_t len) {
  uint8_t diff = 0;
  for (size_t i = 0; i < len; i++) diff |= (uint8_t)(a[i] ^ b[i]);
  return diff == 0;
}

static bool verifySignedCommand(const char* cmd, int gate, const String& sessionId,
                                int signedDuration, uint32_t ts, const String& sigHex) {
  char buf[256];
  int n = snprintf(buf, sizeof(buf), "%s|%d|%s|%d|%u",
                   cmd, gate, sessionId.c_str(), signedDuration, (unsigned)ts);
  if (n <= 0 || (size_t)n >= sizeof(buf)) {
    Serial.println("[AUTH] payload too long");
    return false;
  }
  uint8_t expected[32];
  if (!computeHmac(buf, n, expected)) return false;
  uint8_t received[32];
  if (!hexToBytes(sigHex, received, 32)) return false;
  if (!ctEqual(expected, received, 32)) {
    Serial.println("[AUTH] signature mismatch");
    return false;
  }
  if (ts <= lastTs) {
    Serial.printf("[AUTH] replay rejected ts=%u lastTs=%u\n", (unsigned)ts, (unsigned)lastTs);
    return false;
  }
  return true;
}

// ---- BLE callbacks --------------------------------------------------------
class ServerCallbacks : public NimBLEServerCallbacks {
  void onConnect(NimBLEServer*, NimBLEConnInfo&) override {
    bleConnected = true;
    Serial.println("[BLE] phone connected");
  }
  void onDisconnect(NimBLEServer*, NimBLEConnInfo&, int reason) override {
    bleConnected = false;
    Serial.printf("[BLE] phone disconnected (reason=%d). resuming advertising\n", reason);
    NimBLEDevice::startAdvertising();
  }
};

class UnlockCallbacks : public NimBLECharacteristicCallbacks {
  void onWrite(NimBLECharacteristic* chr, NimBLEConnInfo&) override {
    std::string raw = chr->getValue();
    Serial.printf("[BLE] received write: %s\n", raw.c_str());
    JsonDocument doc;
    if (deserializeJson(doc, raw)) {
      Serial.println("[BLE] JSON parse failed");
      return;
    }
    String   cmd       = doc["cmd"]          | "";
    String   sessionId = doc["session_id"]   | "";
    int      gate      = doc["gate"]         | 1;
    int      durMin    = doc["duration_min"] | 0;
    uint32_t ts        = (uint32_t)(doc["ts"] | (uint32_t)0);
    String   sigHex    = doc["sig"]          | "";

    if (sigHex.length() == 0 || ts == 0) {
      Serial.println("[AUTH] missing ts/sig — rejecting");
      return;
    }
    if (gate < 1 || gate > NUM_GATES) {
      Serial.printf("[CMD] bad gate index %d (have %d gates)\n", gate, NUM_GATES);
      return;
    }
    int g = gate - 1;
    int signedDuration = (cmd == "unlock") ? durMin : 0;
    if (!verifySignedCommand(cmd.c_str(), gate, sessionId, signedDuration, ts, sigHex)) {
      return;
    }
    lastTs = ts;
    prefs.putUInt("lastTs", lastTs);

    if (cmd == "unlock" && gateState[g] == LOCKED) {
      activeSessionId[g] = sessionId;
      durationMin[g]     = (uint16_t)durMin;
      Serial.printf("[CMD] unlock gate %d session=%s duration=%u min\n",
                    gate, sessionId.c_str(), durationMin[g]);
      triggerSolenoid(g);
      transitionTo(g, UNLOCKED);
    } else if (cmd == "return_unlock" && gateState[g] == IN_USE && sessionId == activeSessionId[g]) {
      Serial.printf("[CMD] return_unlock gate %d\n", gate);
      triggerSolenoid(g);
      transitionTo(g, RETURN_UNLOCKED);
    } else {
      Serial.printf("[BLE] cmd '%s' for gate %d ignored in state %s\n",
                    cmd.c_str(), gate, stateName(gateState[g]));
    }
  }
};

// ---- Setup -----------------------------------------------------------------
void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("\n=== Playbox 3-gate firmware (v0.4.0-3gate) ===");

  pinMode(LED_PIN, OUTPUT);

  // Active-LOW relay: drive pin HIGH on boot so the relay stays off and the
  // solenoid stays de-energised (latch engaged, door held shut). Set the
  // level BEFORE pinMode so we never glitch the relay LOW during the brief
  // moment the pin defaults to LOW after configure-as-output.
  for (int g = 0; g < NUM_GATES; g++) {
    digitalWrite(SOLENOID_PINS[g], RELAY_INACTIVE);
    pinMode(SOLENOID_PINS[g], OUTPUT);
    digitalWrite(SOLENOID_PINS[g], RELAY_INACTIVE);
  }
  initReeds();

  // NVS — restore per-gate state across power cycles.
  prefs.begin("playbox", false);
  loadAll();
  for (int g = 0; g < NUM_GATES; g++) {
    stateEnteredMs[g] = millis();
    Serial.printf("[NVS] gate %d state=%s session='%s'\n",
                  g + 1, stateName(gateState[g]), activeSessionId[g].c_str());
  }
  Serial.printf("[NVS] lastTs=%u\n", (unsigned)lastTs);

  // Watchdog.
#if ESP_ARDUINO_VERSION_MAJOR >= 3
  esp_task_wdt_config_t wdtCfg = {
    .timeout_ms     = WDT_TIMEOUT_S * 1000,
    .idle_core_mask = 0,
    .trigger_panic  = true,
  };
  esp_task_wdt_init(&wdtCfg);
#else
  esp_task_wdt_init(WDT_TIMEOUT_S, true);
#endif
  esp_task_wdt_add(NULL);
  Serial.printf("[WDT] armed (%us)\n", WDT_TIMEOUT_S);

  // BLE.
  NimBLEDevice::init("Playbox-DEV-001");
  NimBLEServer* server = NimBLEDevice::createServer();
  server->setCallbacks(new ServerCallbacks());

  NimBLEService* service = server->createService(SERVICE_UUID);

  NimBLECharacteristic* unlockChar = service->createCharacteristic(
    UNLOCK_CHAR_UUID, NIMBLE_PROPERTY::WRITE);
  unlockChar->setCallbacks(new UnlockCallbacks());

  eventsChar = service->createCharacteristic(
    EVENTS_CHAR_UUID, NIMBLE_PROPERTY::NOTIFY);

  NimBLECharacteristic* infoChar = service->createCharacteristic(
    INFO_CHAR_UUID, NIMBLE_PROPERTY::READ);

  JsonDocument info;
  info["station_id"]  = "DEV-001";
  info["fw"]          = "0.4.0-3gate";
  info["gates"]       = NUM_GATES;
  info["battery_pct"] = 100;  // TODO: ADC + voltage divider
  String infoStr;
  serializeJson(info, infoStr);
  infoChar->setValue(infoStr);

  service->start();
  NimBLEAdvertising* adv = NimBLEDevice::getAdvertising();
  adv->addServiceUUID(SERVICE_UUID);
  adv->setName("Playbox-DEV-001");
  adv->start();

  Serial.println("[BLE] advertising as 'Playbox-DEV-001'");
  emitBoot();
}

// ---- Loop ------------------------------------------------------------------
unsigned long lastHeartbeat = 0;

void loop() {
  esp_task_wdt_reset();

  // Heartbeat LED.
  if (millis() - lastHeartbeat > 1000) {
    digitalWrite(LED_PIN, !digitalRead(LED_PIN));
    lastHeartbeat = millis();
  }

  tickSolenoids();  // drop pulse pins LOW when their timer expires
  pollReeds();      // detect door-closed transitions
  checkTimeouts();  // per-gate state timeouts

  delay(5);
}
