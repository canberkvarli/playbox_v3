// =============================================================================
// Playbox Station — Phase 0 firmware (breadboard smoke test)
// =============================================================================
// Hardware:
//   - ESP32 WROOM-32 (board: "ESP32 Dev Module" / NodeMCU-32S)
//   - MG996R servo on GPIO 13 (signal). Power servo from LM2596 5V, NOT 3.3V.
//   - Onboard LED on GPIO 2  (heartbeat blink, proves the loop is alive)
//   - BOOT button on GPIO 0  (used as a fake reed switch — press = "gate closed")
//
// Behavior — single-gate state machine:
//   LOCKED    --(unlock cmd from app)-->        UNLOCKED   (servo to 90deg)
//   UNLOCKED  --(button press = ball taken)-->  IN_USE     (servo back to 0deg)
//   IN_USE    --(return_unlock cmd from app)--> RETURN_UNLOCKED (servo to 90deg)
//   RETURN_U. --(button press = ball returned)->LOCKED     (servo to 0deg, EMIT gate_closed)
//
// Reliability + security features (v0.3.0):
//   - 30s task watchdog: auto-reboots if loop wedges
//   - State timeouts:    UNLOCKED auto-locks after 30s, RETURN_UNLOCKED after 60s,
//                        IN_USE emits ball_overdue after duration_min minutes
//   - NVS persistence:   gate state + active session survive power cycles / resets
//   - HMAC-SHA256 auth:  every unlock/return_unlock command must carry a valid
//                        signature from the backend. Phone is a dumb pipe;
//                        anyone with nRF Connect can no longer pop the gate.
//   - Replay protection: monotonic ts (server clock) — payloads with ts <=
//                        lastTs in NVS are rejected. ESP32 has no RTC, so this
//                        is the cheapest watertight defense.
//
// Wire format matches lib/ble/protocol.ts in the Playbox app.
// =============================================================================

#include <NimBLEDevice.h>
#include <ArduinoJson.h>
#include <ESP32Servo.h>
#include <Preferences.h>
#include "esp_task_wdt.h"
#include "mbedtls/md.h"

// ---- Pins -------------------------------------------------------------------
#define LED_PIN     2
#define BUTTON_PIN  0   // BOOT button on most ESP32 DevKits (active LOW)
#define SERVO_PIN   13

// ---- Servo angles -----------------------------------------------------------
#define ANGLE_LOCKED    0
#define ANGLE_UNLOCKED  90

// ---- Timeouts & watchdog ----------------------------------------------------
#define UNLOCKED_TIMEOUT_MS         30000UL  // auto-lock if user doesn't take ball
#define RETURN_UNLOCKED_TIMEOUT_MS  60000UL  // auto-revert if return window expires
#define WDT_TIMEOUT_S               30
#define DEFAULT_DURATION_MIN        30

// ---- BLE UUIDs (must match lib/ble/protocol.ts) -----------------------------
#define SERVICE_UUID     "12345678-1234-5678-1234-56789abcdef0"
#define UNLOCK_CHAR_UUID "12345678-1234-5678-1234-56789abcdef1"
#define EVENTS_CHAR_UUID "12345678-1234-5678-1234-56789abcdef2"
#define INFO_CHAR_UUID   "12345678-1234-5678-1234-56789abcdef3"

// ---- State ------------------------------------------------------------------
enum GateState { LOCKED, UNLOCKED, IN_USE, RETURN_UNLOCKED };
const char* stateName(GateState s) {
  switch (s) {
    case LOCKED: return "LOCKED";
    case UNLOCKED: return "UNLOCKED";
    case IN_USE: return "IN_USE";
    case RETURN_UNLOCKED: return "RETURN_UNLOCKED";
  }
  return "?";
}

GateState                 gateState = LOCKED;
String                    activeSessionId = "";
Servo                     gateServo;
NimBLECharacteristic*     eventsChar = nullptr;
bool                      bleConnected = false;

Preferences               prefs;
uint16_t                  durationMin       = DEFAULT_DURATION_MIN;
unsigned long             stateEnteredMs    = 0;
bool                      overdueSent       = false;
uint32_t                  lastTs            = 0;  // monotonic, persisted

// ---- Per-station secret ----------------------------------------------------
// Phase 0: hardcoded. Must match the Supabase env var
//   PLAYBOX_STATION_SECRET_DEV_001
// (set it to the lowercase hex form of the bytes below).
// Phase 1+ will provision per-station secrets to NVS at first boot via a
// one-time pairing flow; never bake real production secrets into firmware.
static const uint8_t DEV_001_SECRET[32] = {
  0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77,
  0x88, 0x99, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff,
  0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77,
  0x88, 0x99, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff,
};

// ---- Event emitter (sends a JSON notification on the EVENTS characteristic) -
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

void emitGateClosed(int gate, const String& sessionId) {
  JsonDocument doc;
  doc["event"] = "gate_closed";
  doc["gate"] = gate;
  doc["session_id"] = sessionId;
  emitEvent(doc);
}

void emitBoot() {
  JsonDocument doc;
  doc["event"] = "boot";
  emitEvent(doc);
}

void emitTimeout(const char* kind, const String& sessionId) {
  JsonDocument doc;
  doc["event"] = kind;
  doc["session_id"] = sessionId;
  emitEvent(doc);
}

// ---- Persistence (NVS) ------------------------------------------------------
// State + session survive resets so a brief brown-out or watchdog reboot
// mid-session doesn't strand the user with a "session not found" error.
void saveState() {
  prefs.putUChar("state",    (uint8_t)gateState);
  prefs.putString("session", activeSessionId);
  prefs.putUShort("duration", durationMin);
  prefs.putBool("overdue",   overdueSent);
}

void loadState() {
  gateState        = (GateState)prefs.getUChar("state", LOCKED);
  activeSessionId  = prefs.getString("session", "");
  durationMin      = prefs.getUShort("duration", DEFAULT_DURATION_MIN);
  overdueSent      = prefs.getBool("overdue", false);
  lastTs           = prefs.getUInt("lastTs", 0);
}

// Single chokepoint for state transitions — guarantees NVS is in sync and the
// per-state timeout clock is reset every time we move.
void transitionTo(GateState next) {
  Serial.printf("[STATE] %s -> %s\n", stateName(gateState), stateName(next));
  gateState      = next;
  stateEnteredMs = millis();
  if (next == LOCKED) {
    activeSessionId = "";
    durationMin     = DEFAULT_DURATION_MIN;
    overdueSent     = false;
  } else if (next == IN_USE) {
    overdueSent     = false;
  }
  saveState();
}

// ---- Timeout checks ---------------------------------------------------------
void checkTimeouts() {
  unsigned long elapsed = millis() - stateEnteredMs;

  if (gateState == UNLOCKED && elapsed > UNLOCKED_TIMEOUT_MS) {
    Serial.println("[TIMEOUT] UNLOCKED expired — auto-locking");
    gateServo.write(ANGLE_LOCKED);
    emitTimeout("unlock_timeout", activeSessionId);
    transitionTo(LOCKED);
  } else if (gateState == RETURN_UNLOCKED && elapsed > RETURN_UNLOCKED_TIMEOUT_MS) {
    Serial.println("[TIMEOUT] RETURN_UNLOCKED expired — locking back to IN_USE");
    gateServo.write(ANGLE_LOCKED);
    emitTimeout("return_timeout", activeSessionId);
    transitionTo(IN_USE);
  } else if (gateState == IN_USE && !overdueSent && durationMin > 0 &&
             elapsed > (unsigned long)durationMin * 60UL * 1000UL) {
    Serial.println("[TIMEOUT] IN_USE duration exceeded — emitting ball_overdue");
    emitTimeout("ball_overdue", activeSessionId);
    overdueSent = true;
    saveState();
  }
}

// ---- HMAC verification -----------------------------------------------------
// Canonical signing string (must match supabase/functions/_shared/blesign.ts):
//   `${cmd}|${gate}|${session_id}|${duration_min_or_0}|${ts}`
//
// `duration_min_or_0` is the numeric duration for `unlock` and literally 0
// for `return_unlock` — we keep both commands using the same canonical form
// so there's only one signing function on the server.
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

// Constant-time compare — don't leak signature bytes via timing side-channel.
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
    Serial.println("[AUTH] payload too long for signing buffer");
    return false;
  }

  uint8_t expected[32];
  if (!computeHmac(buf, n, expected)) {
    Serial.println("[AUTH] hmac compute failed");
    return false;
  }

  uint8_t received[32];
  if (!hexToBytes(sigHex, received, 32)) {
    Serial.println("[AUTH] sig hex decode failed");
    return false;
  }

  if (!ctEqual(expected, received, 32)) {
    Serial.println("[AUTH] signature mismatch");
    return false;
  }

  if (ts <= lastTs) {
    Serial.printf("[AUTH] replay rejected: ts=%u <= lastTs=%u\n",
                  (unsigned)ts, (unsigned)lastTs);
    return false;
  }

  return true;
}

// ---- BLE callbacks ----------------------------------------------------------
class ServerCallbacks : public NimBLEServerCallbacks {
  void onConnect(NimBLEServer* server, NimBLEConnInfo& info) override {
    bleConnected = true;
    Serial.println("[BLE] phone connected");
  }
  void onDisconnect(NimBLEServer* server, NimBLEConnInfo& info, int reason) override {
    bleConnected = false;
    Serial.printf("[BLE] phone disconnected (reason=%d). resuming advertising\n", reason);
    NimBLEDevice::startAdvertising();
  }
};

class UnlockCallbacks : public NimBLECharacteristicCallbacks {
  void onWrite(NimBLECharacteristic* chr, NimBLEConnInfo& info) override {
    std::string raw = chr->getValue();
    Serial.printf("[BLE] received write: %s\n", raw.c_str());

    JsonDocument doc;
    if (deserializeJson(doc, raw)) {
      Serial.println("[BLE] JSON parse failed, ignoring");
      return;
    }

    String   cmd       = doc["cmd"]          | "";
    String   sessionId = doc["session_id"]   | "";
    int      gate      = doc["gate"]         | 1;
    int      durMin    = doc["duration_min"] | 0;
    uint32_t ts        = (uint32_t)(doc["ts"] | (uint32_t)0);
    String   sigHex    = doc["sig"]          | "";

    // ---- Auth gate -----------------------------------------------------
    // Reject any command without a signature outright. This is the line
    // that prevents nRF Connect or any random BLE peer from popping the
    // gate by writing `{"cmd":"unlock"}`.
    if (sigHex.length() == 0 || ts == 0) {
      Serial.println("[AUTH] missing ts/sig — rejecting");
      return;
    }
    int signedDuration = (cmd == "unlock") ? durMin : 0;
    if (!verifySignedCommand(cmd.c_str(), gate, sessionId, signedDuration, ts, sigHex)) {
      // verifySignedCommand already logged the reason
      return;
    }
    // Commit the new high-water-mark *before* the state-machine logic so a
    // subsequent state-rejection still consumes the ts and blocks replay.
    lastTs = ts;
    prefs.putUInt("lastTs", lastTs);

    if (cmd == "unlock" && gateState == LOCKED) {
      activeSessionId = sessionId;
      durationMin     = (uint16_t)durMin;
      Serial.printf("[CMD] unlock session=%s duration=%u min\n", sessionId.c_str(), durationMin);
      gateServo.write(ANGLE_UNLOCKED);
      transitionTo(UNLOCKED);
    } else if (cmd == "return_unlock" && gateState == IN_USE && sessionId == activeSessionId) {
      Serial.println("[CMD] return_unlock");
      gateServo.write(ANGLE_UNLOCKED);
      transitionTo(RETURN_UNLOCKED);
    } else {
      Serial.printf("[BLE] cmd '%s' ignored in state %s\n", cmd.c_str(), stateName(gateState));
    }
  }
};

// ---- Setup ------------------------------------------------------------------
void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("\n=== Playbox Phase 0 firmware (v0.3.0-phase0) ===");

  pinMode(LED_PIN, OUTPUT);
  pinMode(BUTTON_PIN, INPUT_PULLUP);

  // ---- NVS: restore state across power cycles -------------------------------
  prefs.begin("playbox", false);
  loadState();
  stateEnteredMs = millis();
  Serial.printf("[NVS] restored state=%s session='%s' duration=%u min overdueSent=%d lastTs=%u\n",
                stateName(gateState), activeSessionId.c_str(), durationMin, overdueSent, (unsigned)lastTs);

  // ---- Watchdog: panic-reboot if loop() wedges for >WDT_TIMEOUT_S -----------
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
  Serial.printf("[WDT] watchdog armed (%us timeout)\n", WDT_TIMEOUT_S);

  // ---- Servo — drive to whatever position matches the restored state -------
  ESP32PWM::allocateTimer(0);
  gateServo.setPeriodHertz(50);
  gateServo.attach(SERVO_PIN, 500, 2400);
  bool gateOpen = (gateState == UNLOCKED || gateState == RETURN_UNLOCKED);
  int  initAngle = gateOpen ? ANGLE_UNLOCKED : ANGLE_LOCKED;
  gateServo.write(initAngle);
  Serial.printf("[INIT] servo at %ddeg (%s)\n", initAngle, stateName(gateState));

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
  info["fw"]          = "0.3.0-phase0";
  info["gates"]       = 1;
  info["battery_pct"] = 100;  // TODO: replace with ADC read once voltage divider is wired
  String infoStr;
  serializeJson(info, infoStr);
  infoChar->setValue(infoStr);

  service->start();

  NimBLEAdvertising* adv = NimBLEDevice::getAdvertising();
  adv->addServiceUUID(SERVICE_UUID);
  adv->setName("Playbox-DEV-001");
  adv->start();

  Serial.println("[BLE] advertising as 'Playbox-DEV-001'");
  Serial.println("[READY] waiting for app to connect");
  emitBoot();
}

// ---- Loop -------------------------------------------------------------------
unsigned long lastHeartbeat   = 0;
int           lastBtn         = HIGH;
unsigned long lastBtnChangeMs = 0;

void loop() {
  esp_task_wdt_reset();

  // Heartbeat LED — toggle every 1s so you can see the loop is alive
  if (millis() - lastHeartbeat > 1000) {
    digitalWrite(LED_PIN, !digitalRead(LED_PIN));
    lastHeartbeat = millis();
  }

  // Auto-recovery if a state lingers too long
  checkTimeouts();

  // BOOT button polling with 50ms debounce — fake reed switch
  int btn = digitalRead(BUTTON_PIN);
  if (btn != lastBtn && (millis() - lastBtnChangeMs) > 50) {
    lastBtn = btn;
    lastBtnChangeMs = millis();

    if (btn == LOW) {  // button pressed (active LOW) = "gate closed"
      if (gateState == UNLOCKED) {
        Serial.println("[BTN] gate closed after pickup — UNLOCKED -> IN_USE");
        gateServo.write(ANGLE_LOCKED);
        transitionTo(IN_USE);
        // No event emitted: taking the ball isn't a session end
      } else if (gateState == RETURN_UNLOCKED) {
        Serial.println("[BTN] gate closed after return — RETURN_UNLOCKED -> LOCKED (session ends)");
        gateServo.write(ANGLE_LOCKED);
        emitGateClosed(1, activeSessionId);
        transitionTo(LOCKED);
      } else {
        Serial.printf("[BTN] press ignored in state %s\n", stateName(gateState));
      }
    }
  }

  delay(10);
}
