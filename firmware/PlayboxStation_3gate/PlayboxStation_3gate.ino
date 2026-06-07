// =============================================================================
// Playbox 3-gate station firmware — v2 (v0.5.0-3gate)
// =============================================================================
//
// PLUG-AND-PLAY PRODUCTION SKETCH for the ESP32 inside a 3-gate Playbox rental
// station. This is the v2 upgrade of PlayboxStation_3gate.ino.
//
// What's new in v2 vs v1:
//   - All outbound events are SIGNED + SEQUENCED via the host-tested signing
//     core (firmware/crypto/playbox_sign.*). Signatures are byte-for-byte
//     identical to the server (supabase/functions/_shared). Firmware NEVER
//     hand-rolls a canonical string or an HMAC — it always calls the core.
//   - Monotonic eventSeq (uint32, persisted, never reset, ++ before each emit).
//   - NVS ring buffer (K=64) of emitted signed-event JSON, persisted so a
//     reboot never loses an unacked event. Drained by the app over BUFFER_CHAR;
//     dropped when the app writes back an `ack` with the highest seq it stored.
//   - set_time (UNSIGNED) → bootEpoch, so every event carries a real wall-clock
//     ts. ack (UNSIGNED) → drop buffered events with seq<=acked_seq.
//   - Per-gate INFO object the app parses (station_id/fw/battery/gates[]).
//   - SLA battery curve over an ADC divider; battery_low/battery_critical
//     events (signed, with mv); refuse new unlock at critical, always honor
//     return_unlock (never trap a user).
//   - Boot-time sign self-test against a known golden vector so a flash that
//     breaks signing is caught immediately (blinks LED + Serial error).
//
// -----------------------------------------------------------------------------
// HARDWARE (carried over from v1; servos per spec)
//   - 3x MG996R servos (gate actuators):  Gate1 GPIO 13, Gate2 GPIO 12,
//     Gate3 GPIO 14. Powered from a separate 5–6V supply (LM2596), GND shared
//     with the ESP32. NEVER power the servos from the ESP32 5V/3V3 pin.
//   - 3x reed switches (door-closed sensors): Gate1 GPIO 18, Gate2 GPIO 19,
//     Gate3 GPIO 21. Wired GPIO↔GND, INPUT_PULLUP. LOW = magnet near = closed.
//   - Battery sense: ADC divider on GPIO 34 (input-only ADC1 pin). See
//     BATTERY section for the ~5:1 divider + calibration notes.
//   - Onboard LED GPIO 2 (heartbeat blink; also self-test error pattern).
//
// State machine (per gate, independent):
//   LOCKED          --(unlock)----------->  UNLOCKED        servo opens
//   UNLOCKED        --(reed: closed)----->  IN_USE          user took item
//   IN_USE          --(return_unlock)---->  RETURN_UNLOCKED servo opens
//   RETURN_UNLOCKED --(reed: closed)----->  LOCKED          emits gate_closed
//
// -----------------------------------------------------------------------------
// BUILD NOTE (IMPORTANT): the Arduino IDE only compiles sources that live IN
// the sketch folder (PlayboxStation_3gate/). The signing core lives in
// firmware/crypto/. Before flashing, COPY (or symlink) these four files into
// this sketch folder so the IDE picks them up:
//     crypto/playbox_sign.c   crypto/playbox_sign.h
//     crypto/sha256.c         crypto/sha256.h
// then include them as below. The include path here assumes the files are
// reachable as "crypto/playbox_sign.h" (e.g. copy the whole crypto/ subdir
// into the sketch folder, or add the folder to the build). README documents
// this. The .c files MUST compile in the sketch build — they are plain C99 and
// already pass the host test suite (firmware/test/run.sh).
// =============================================================================

#include <string.h>   // strcmp — used to gate the battery-mv field by event name
#include <NimBLEDevice.h>
#include <ArduinoJson.h>
#include <ESP32Servo.h>
#include <Preferences.h>
#include <esp_task_wdt.h>

extern "C" {
  #include "crypto/playbox_sign.h"   // canonical builders + sign/verify (host-tested)
}

// ---- Station identity & secret ---------------------------------------------
// Each physical station ships with a UNIQUE 64-hex (32-byte) secret, provisioned
// at manufacture and mirrored in the server's station row. The HMAC key is the
// 32 RAW BYTES decoded from this hex (NOT the utf8 string). REPLACE the
// placeholder below per-station before flashing a production unit.
//
// NOTE: the value below is the DEV-001 dev secret == the host test-vector
// secret, purely so the self-test (which uses SELFTEST_SECRET_HEX) and the
// device sign the same way on the bench. For production, generate a fresh
// secret per station and update the server station row to match.
#define STATION_ID         "DEV-001"
#define FW_VERSION         "0.5.0-3gate"
#define STATION_SECRET_HEX "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff"

// Self-test secret: the pinned host-test vector secret. Kept SEPARATE from the
// station secret so the self-test works even on a unit provisioned with a real
// (different) STATION_SECRET_HEX — it proves the SIGNING CORE is intact, not
// the station key. The golden sig below is the gate_closed vector signed with
// THIS secret (see firmware/test/test_sign.c [0]).
#define SELFTEST_SECRET_HEX "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff"
#define SELFTEST_GOLDEN_SIG "33414e3eb9a1788c3c19cf620e5d064cb549f5a8b377b02d465ff3285fd6fd85"

// ---- Pins -------------------------------------------------------------------
#define LED_PIN     2
#define NUM_GATES   3
static const uint8_t SERVO_PINS[NUM_GATES] = { 13, 12, 14 };
static const uint8_t REED_PINS[NUM_GATES]  = { 18, 19, 21 };

// Battery ADC: ADC1 input-only pin (safe alongside WiFi/BLE, unlike ADC2).
#define BATTERY_ADC_PIN 34

// ---- Servo geometry & timing ------------------------------------------------
#define SERVO_LOCKED_DEG    0     // latch engaged / door held shut
#define SERVO_OPEN_DEG      90    // door released
#define SERVO_OPEN_HOLD_MS  800UL // hold OPEN before the relax-back tick runs
#define UNLOCKED_TIMEOUT_MS        300000UL // user didn't take ball (5min, bench-friendly)
#define RETURN_UNLOCKED_TIMEOUT_MS  60000UL // user didn't return ball
#define WDT_TIMEOUT_S       30
#define DEFAULT_DURATION_MIN 30
#define REED_DEBOUNCE_MS    50

// ---- BLE UUIDs (must match lib/ble/protocol.ts) ----------------------------
//   SERVICE ...def0, UNLOCK ...def1, EVENTS ...def2, INFO ...def3, BUFFER ...def4
#define SERVICE_UUID     "12345678-1234-5678-1234-56789abcdef0"
#define UNLOCK_CHAR_UUID "12345678-1234-5678-1234-56789abcdef1"
#define EVENTS_CHAR_UUID "12345678-1234-5678-1234-56789abcdef2"
#define INFO_CHAR_UUID   "12345678-1234-5678-1234-56789abcdef3"
#define BUFFER_CHAR_UUID "12345678-1234-5678-1234-56789abcdef4"

// ---- Battery (SLA 12V) ------------------------------------------------------
// Voltage divider scales the 10.5–13V battery rail into the ESP32 ADC range
// (0–3.3V at 11dB attenuation). With R1=39k (top) / R2=10k (bottom) the ratio
// is (39+10)/10 = 4.9 (~5:1): 13.0V → 2.65V at the pin, comfortably under 3.3V.
// CALIBRATE per board: measure the real rail with a DMM and the pin voltage,
// then trim BATTERY_DIVIDER. The ESP32 ADC is non-linear near the rails, so the
// constant absorbs that too. READ AT REST — never during a servo pulse (the
// inrush sags the rail and would falsely trip battery_low/critical).
#define BATTERY_DIVIDER     4.9f
#define ADC_VREF            3.30f
#define ADC_MAX             4095.0f
#define BATTERY_LOW_MV      11900   // ≈40% SoC — emit battery_low (signed, +mv)
#define BATTERY_CRIT_MV     11500   // ≈20% SoC — emit battery_critical + refuse unlock
#define BATTERY_HYST_MV     150     // re-arm hysteresis so we emit once per crossing
#define BATTERY_SAMPLE_MS   30000UL // sample cadence (also gates emit-once logic)

// ---- Event ring buffer ------------------------------------------------------
#define RING_K 64   // max unacked signed events held in NVS

// =============================================================================
// State
// =============================================================================
enum GateState { LOCKED, UNLOCKED, IN_USE, RETURN_UNLOCKED };
static const char* stateName(GateState s) {
  switch (s) {
    case LOCKED:          return "LOCKED";
    case UNLOCKED:        return "UNLOCKED";
    case IN_USE:          return "IN_USE";
    case RETURN_UNLOCKED: return "RETURN_UNLOCKED";
  }
  return "?";
}

// Per-gate runtime. Index 0..NUM_GATES-1 ⇄ user-facing gate 1..NUM_GATES.
GateState     gateState[NUM_GATES];
String        activeSessionId[NUM_GATES];
uint16_t      durationMin[NUM_GATES];
unsigned long stateEnteredMs[NUM_GATES];
bool          overdueSent[NUM_GATES];

// Servos.
Servo         servos[NUM_GATES];
unsigned long servoRelaxMs[NUM_GATES] = { 0 };

// Reed debouncing.
int           lastReed[NUM_GATES];
unsigned long lastReedChangeMs[NUM_GATES] = { 0 };

// Signing.
uint8_t       gKey[32];          // decoded station secret (32 raw bytes)
bool          gKeyOk = false;

// Time / replay / sequence (persisted in NVS).
uint32_t      bootEpoch = 0;     // unix secs at millis()==0; 0 = not yet set
uint32_t      lastTs    = 0;     // replay guard: highest accepted command ts
uint32_t      eventSeq  = 0;     // monotonic, never reset, ++ before each emit
uint32_t      ackedSeq  = 0;     // app has durably stored events with seq<=this

// Battery.
int           batteryMv  = 0;
int           batteryPct = 100;
bool          lowArmed   = true; // can emit battery_low again once re-armed
bool          critArmed  = true;
unsigned long lastBatterySampleMs = 0;
bool          batteryCritical = false; // gates new unlocks

// BLE handles.
NimBLECharacteristic* eventsChar = nullptr;
NimBLECharacteristic* infoChar   = nullptr;
NimBLECharacteristic* bufferChar = nullptr;
volatile bool bleConnected = false;

Preferences prefs;

// =============================================================================
// NVS persistence
//   Namespace "playbox". Keys:
//     "seq"      uint32  eventSeq (monotonic, never reset)
//     "acked"    uint32  ackedSeq
//     "epoch"    uint32  bootEpoch (from set_time)
//     "lastTs"   uint32  replay guard
//     "st%d"     uchar   per-gate GateState
//     "sid%d"    string  per-gate session_id
//     "dur%d"    ushort  per-gate duration_min
//     "rh"       uint32  ring head index (next write slot, mod RING_K)
//     "rc"       uint32  ring count (live entries, <= RING_K)
//     "rs%lu"    string  ring slot: a signed-event JSON line (or removed)
//     "rq%lu"    uint32  ring slot: that event's seq (for ack-drop)
// =============================================================================
static void saveGate(int g) {
  char key[12];
  snprintf(key, sizeof(key), "st%d", g);  prefs.putUChar(key, (uint8_t)gateState[g]);
  snprintf(key, sizeof(key), "sid%d", g); prefs.putString(key, activeSessionId[g]);
  snprintf(key, sizeof(key), "dur%d", g); prefs.putUShort(key, durationMin[g]);
}

static void loadAll() {
  for (int g = 0; g < NUM_GATES; g++) {
    char key[12];
    snprintf(key, sizeof(key), "st%d", g);
    gateState[g] = (GateState)prefs.getUChar(key, LOCKED);
    snprintf(key, sizeof(key), "sid%d", g);
    activeSessionId[g] = prefs.getString(key, "");
    snprintf(key, sizeof(key), "dur%d", g);
    durationMin[g] = prefs.getUShort(key, DEFAULT_DURATION_MIN);
    overdueSent[g] = false;
  }
  eventSeq  = prefs.getUInt("seq", 0);
  ackedSeq  = prefs.getUInt("acked", 0);
  bootEpoch = prefs.getUInt("epoch", 0);
  lastTs    = prefs.getUInt("lastTs", 0);
}

// =============================================================================
// Time
// =============================================================================
// wall_ts = bootEpoch + uptimeSecs, once set_time has anchored bootEpoch.
// Before set_time arrives we fall back to raw uptime (millis()/1000) so events
// still carry a monotonic-ish ts the server can order.
static uint32_t wallTs() {
  uint32_t up = (uint32_t)(millis() / 1000UL);
  return bootEpoch ? (bootEpoch + up) : up;
}

// =============================================================================
// Event ring buffer (persisted)
// =============================================================================
static uint32_t ringHead()  { return prefs.getUInt("rh", 0); }
static uint32_t ringCount() { return prefs.getUInt("rc", 0); }

// Append a fully-built signed-event JSON line + its seq into the ring. If the
// ring is full the oldest entry is overwritten (head advances over it). The app
// is expected to drain BUFFER_CHAR well before 64 events accumulate.
static void ringAppend(const String& json, uint32_t seq) {
  uint32_t head = ringHead();
  uint32_t cnt  = ringCount();
  char k[12];
  snprintf(k, sizeof(k), "rs%lu", (unsigned long)head); prefs.putString(k, json);
  snprintf(k, sizeof(k), "rq%lu", (unsigned long)head); prefs.putUInt(k, seq);
  head = (head + 1) % RING_K;
  if (cnt < RING_K) cnt++;
  prefs.putUInt("rh", head);
  prefs.putUInt("rc", cnt);
}

// Build the JSON array of pending events (seq > ackedSeq) for BUFFER_CHAR.
static String ringPendingJson() {
  uint32_t head = ringHead();
  uint32_t cnt  = ringCount();
  String out = "[";
  bool first = true;
  // Oldest live entry is at (head - cnt) mod K.
  for (uint32_t i = 0; i < cnt; i++) {
    uint32_t idx = (head + RING_K - cnt + i) % RING_K;
    char k[12];
    snprintf(k, sizeof(k), "rq%lu", (unsigned long)idx);
    uint32_t seq = prefs.getUInt(k, 0);
    if (seq <= ackedSeq) continue;            // already acked — skip
    snprintf(k, sizeof(k), "rs%lu", (unsigned long)idx);
    String json = prefs.getString(k, "");
    if (json.length() == 0) continue;
    if (!first) out += ",";
    out += json;
    first = false;
  }
  out += "]";
  return out;
}

// Drop acked entries from the oldest end: clear any slot whose seq <= ackedSeq
// and shrink the live count. Stops at the first still-pending entry.
static void ringDropAcked() {
  uint32_t head = ringHead();
  uint32_t cnt  = ringCount();
  while (cnt > 0) {
    uint32_t oldest = (head + RING_K - cnt) % RING_K;
    char k[12];
    snprintf(k, sizeof(k), "rq%lu", (unsigned long)oldest);
    uint32_t seq = prefs.getUInt(k, 0);
    if (seq == 0 || seq > ackedSeq) break;    // still pending
    snprintf(k, sizeof(k), "rs%lu", (unsigned long)oldest); prefs.remove(k);
    snprintf(k, sizeof(k), "rq%lu", (unsigned long)oldest); prefs.remove(k);
    cnt--;
  }
  prefs.putUInt("rc", cnt);
}

static void refreshBufferChar() {
  if (bufferChar) bufferChar->setValue(ringPendingJson());
}

// =============================================================================
// INFO characteristic — the per-gate object the app parses.
//   {"station_id":..,"fw":..,"battery_pct":N,"battery_mv":N,
//    "gates":[{"gate":1,"state":"LOCKED|UNLOCKED|IN_USE|RETURN_UNLOCKED",
//              "session_id":""}, ...]}
// Rebuilt on every state/battery change so a fresh READ always reflects truth.
// =============================================================================
static void refreshInfoChar() {
  if (!infoChar) return;
  JsonDocument info;
  info["station_id"]  = STATION_ID;
  info["fw"]          = FW_VERSION;
  info["battery_pct"] = batteryPct;
  info["battery_mv"]  = batteryMv;
  JsonArray gates = info["gates"].to<JsonArray>();
  for (int g = 0; g < NUM_GATES; g++) {
    JsonObject go = gates.add<JsonObject>();
    go["gate"]       = g + 1;
    go["state"]      = stateName(gateState[g]);
    go["session_id"] = activeSessionId[g];
  }
  String s;
  serializeJson(info, s);
  infoChar->setValue(s);
}

// =============================================================================
// emitEvent — the ONE path every event takes.
//   gate: -1 = none.  session_id: NULL = none.  mv: -1 = none.
// ++seq, builds wall_ts, signs via the CORE (never hand-rolled), builds JSON,
// notifies if connected, and appends to the persisted ring for courier replay.
// =============================================================================
static void emitEvent(const char* event, int gate, const char* session_id, long mv) {
  // ++seq FIRST and persist, so a crash mid-emit can't reuse a seq.
  eventSeq++;
  prefs.putUInt("seq", eventSeq);

  uint32_t ts = wallTs();
  char sig[65] = {0};

  if (gKeyOk) {
    // Canonical + HMAC handled entirely by the host-tested core. The core gates
    // the mv field to battery_low/battery_critical by event NAME, matching the
    // server, so we may safely pass mv for any event (it's ignored otherwise).
    playbox_sign_event(gKey, event, gate, session_id, eventSeq, ts, mv, sig);
  }

  // Build the wire JSON. Field set mirrors the server contract:
  //   {event, gate?, session_id?, seq, ts, sig, mv? (battery only)}
  JsonDocument doc;
  doc["event"] = event;
  if (gate >= 0)  doc["gate"] = gate;
  if (session_id) doc["session_id"] = session_id;
  doc["seq"] = eventSeq;
  doc["ts"]  = ts;
  doc["sig"] = sig;
  // Emit mv ONLY for battery events, matching the canonical the sig covers.
  if (mv >= 0 && (strcmp(event, "battery_low") == 0 ||
                  strcmp(event, "battery_critical") == 0)) {
    doc["mv"] = mv;
  }
  String json;
  serializeJson(doc, json);

  Serial.printf("[EVT] %s\n", json.c_str());

  // Notify the connected app (best-effort; the ring guarantees delivery).
  if (bleConnected && eventsChar) {
    eventsChar->setValue(json);
    eventsChar->notify();
  }

  // Persist into the ring for gossip/courier drain even if offline.
  ringAppend(json, eventSeq);
  refreshBufferChar();
}

// Convenience wrappers ---------------------------------------------------------
static void emitBoot()                                { emitEvent("boot", -1, nullptr, -1); }
static void emitGateOpened(int g1, const String& sid) { emitEvent("gate_opened", g1, sid.c_str(), -1); }
static void emitGateClosed(int g1, const String& sid) { emitEvent("gate_closed", g1, sid.c_str(), -1); }
static void emitTimeout(const char* kind, int g1, const String& sid) { emitEvent(kind, g1, sid.c_str(), -1); }

// =============================================================================
// Servo actuation (non-blocking relax)
// =============================================================================
static void servoOpen(int g) {
  servos[g].write(SERVO_OPEN_DEG);
  servoRelaxMs[g] = millis() + SERVO_OPEN_HOLD_MS;
  Serial.printf("[SERVO] gate %d -> OPEN (%ddeg)\n", g + 1, SERVO_OPEN_DEG);
}

static void servoLock(int g) {
  servos[g].write(SERVO_LOCKED_DEG);
  servoRelaxMs[g] = 0;
  Serial.printf("[SERVO] gate %d -> LOCKED (%ddeg)\n", g + 1, SERVO_LOCKED_DEG);
}

static void tickServos() {
  // After the open hold, drive back to the locked angle if the gate has since
  // returned to LOCKED. The mechanical latch / gas strut holds the door; the
  // servo only sets the latch position.
  for (int g = 0; g < NUM_GATES; g++) {
    if (servoRelaxMs[g] != 0 && (long)(millis() - servoRelaxMs[g]) >= 0) {
      servoRelaxMs[g] = 0;
      if (gateState[g] == LOCKED) servos[g].write(SERVO_LOCKED_DEG);
    }
  }
}

// =============================================================================
// State transitions
// =============================================================================
static void transitionTo(int g, GateState next) {
  Serial.printf("[STATE] gate %d: %s -> %s\n", g + 1, stateName(gateState[g]), stateName(next));
  gateState[g] = next;
  stateEnteredMs[g] = millis();
  if (next == LOCKED) {
    activeSessionId[g] = "";
    overdueSent[g] = false;
    servoLock(g);
  }
  saveGate(g);
  refreshInfoChar();
}

// =============================================================================
// Reed switches
// =============================================================================
static void handleGateClose(int g);

static void initReeds() {
  for (int g = 0; g < NUM_GATES; g++) {
    pinMode(REED_PINS[g], INPUT_PULLUP);
    lastReed[g] = digitalRead(REED_PINS[g]);
    lastReedChangeMs[g] = millis();
  }
}

static void pollReeds() {
  for (int g = 0; g < NUM_GATES; g++) {
    int r = digitalRead(REED_PINS[g]);
    if (r != lastReed[g] && (millis() - lastReedChangeMs[g]) > REED_DEBOUNCE_MS) {
      lastReed[g] = r;
      lastReedChangeMs[g] = millis();
      if (r == LOW) handleGateClose(g);
      else Serial.printf("[REED] gate %d opened\n", g + 1);
    }
  }
}

static void handleGateClose(int g) {
  Serial.printf("[REED] gate %d closed (state %s)\n", g + 1, stateName(gateState[g]));
  if (gateState[g] == UNLOCKED) {
    // User grabbed the ball and closed the door — not a session end, no event.
    transitionTo(g, IN_USE);
  } else if (gateState[g] == RETURN_UNLOCKED) {
    // User returned the ball and closed the door — session ends.
    emitGateClosed(g + 1, activeSessionId[g]);
    transitionTo(g, LOCKED);
  }
}

// =============================================================================
// State timeouts
// =============================================================================
static void checkTimeouts() {
  unsigned long now = millis();
  for (int g = 0; g < NUM_GATES; g++) {
    unsigned long elapsed = now - stateEnteredMs[g];
    if (gateState[g] == UNLOCKED && elapsed > UNLOCKED_TIMEOUT_MS) {
      // Door held open by the strut; no firmware close. Assume the user took
      // the ball, surface a diagnostic, keep the session alive so return_unlock
      // is still possible (it only accepts from IN_USE with a matching session).
      emitTimeout("unlock_timeout", g + 1, activeSessionId[g]);
      transitionTo(g, IN_USE);
    } else if (gateState[g] == RETURN_UNLOCKED && elapsed > RETURN_UNLOCKED_TIMEOUT_MS) {
      emitTimeout("return_timeout", g + 1, activeSessionId[g]);
      transitionTo(g, IN_USE);
    } else if (gateState[g] == IN_USE && !overdueSent[g] && durationMin[g] > 0 &&
               elapsed > (unsigned long)durationMin[g] * 60UL * 1000UL) {
      emitTimeout("ball_overdue", g + 1, activeSessionId[g]);
      overdueSent[g] = true;
      saveGate(g);
    }
  }
}

// =============================================================================
// Battery: median-filtered ADC → resting volts → SoC via SLA curve.
// =============================================================================
static int readBatteryMvOnce() {
  // analogRead at 11dB attenuation maps ~0..3.3V to 0..4095. Scale back through
  // the divider to the rail in millivolts.
  int raw = analogRead(BATTERY_ADC_PIN);
  float vpin = (raw / ADC_MAX) * ADC_VREF;
  float vrail = vpin * BATTERY_DIVIDER;
  return (int)(vrail * 1000.0f);
}

static int median5(int* a) {
  for (int i = 0; i < 5; i++)
    for (int j = i + 1; j < 5; j++)
      if (a[j] < a[i]) { int t = a[i]; a[i] = a[j]; a[j] = t; }
  return a[2];
}

// SLA 12V resting-voltage → State of Charge. Piecewise-linear over the spec
// anchor points: 12.7V=100%, 11.9V≈40%, 11.5V≈20%, 10.5V=0%.
static int mvToSoc(int mv) {
  float v = mv / 1000.0f;
  if (v >= 12.7f) return 100;
  if (v >= 11.9f) return (int)(40 + (v - 11.9f) / (12.7f - 11.9f) * 60.0f); // 40..100
  if (v >= 11.5f) return (int)(20 + (v - 11.5f) / (11.9f - 11.5f) * 20.0f); // 20..40
  if (v >= 10.5f) return (int)( 0 + (v - 10.5f) / (11.5f - 10.5f) * 20.0f); // 0..20
  return 0;
}

// Whether any gate is mid-servo-pulse — skip battery reads then (rail sags).
static bool anyServoActive() {
  for (int g = 0; g < NUM_GATES; g++) if (servoRelaxMs[g] != 0) return true;
  return false;
}

static void sampleBattery() {
  if (millis() - lastBatterySampleMs < BATTERY_SAMPLE_MS) return;
  if (anyServoActive()) return;   // read at rest only
  lastBatterySampleMs = millis();

  int s[5];
  for (int i = 0; i < 5; i++) { s[i] = readBatteryMvOnce(); delayMicroseconds(500); }
  batteryMv  = median5(s);
  batteryPct = mvToSoc(batteryMv);

  // battery_critical: emit once per downward crossing; re-arm above +hyst.
  if (batteryMv <= BATTERY_CRIT_MV) {
    batteryCritical = true;
    if (critArmed) { emitEvent("battery_critical", -1, nullptr, batteryMv); critArmed = false; }
  } else if (batteryMv >= BATTERY_CRIT_MV + BATTERY_HYST_MV) {
    batteryCritical = false;
    critArmed = true;
  }

  // battery_low: same debounce, independent arm flag.
  if (batteryMv <= BATTERY_LOW_MV) {
    if (lowArmed) { emitEvent("battery_low", -1, nullptr, batteryMv); lowArmed = false; }
  } else if (batteryMv >= BATTERY_LOW_MV + BATTERY_HYST_MV) {
    lowArmed = true;
  }

  refreshInfoChar();
}

// =============================================================================
// Boot self-test: prove the signing core is byte-intact. Signs the gate_closed
// golden vector with the SELFTEST secret and compares to the pinned sig. A flash
// that subtly breaks signing (compiler, lib, struct change) is caught here
// before the unit ever issues a real (server-rejected) event.
// =============================================================================
static void blinkError() {
  // Distinct fast pattern so a tech on the bench notices instantly.
  for (int k = 0; k < 10; k++) {
    digitalWrite(LED_PIN, HIGH); delay(80);
    digitalWrite(LED_PIN, LOW);  delay(80);
  }
}

static bool runSignSelfTest() {
  uint8_t k[32];
  if (playbox_hex_decode_key(SELFTEST_SECRET_HEX, k) != 0) {
    Serial.println("SIGN SELF-TEST FAILED (bad selftest secret)");
    return false;
  }
  char sig[65] = {0};
  // Vector [0]: gate_closed, gate=1, session="s1", seq=2, ts=100, mv=-1.
  if (playbox_sign_event(k, "gate_closed", 1, "s1", 2, 100, -1, sig) != 0) {
    Serial.println("SIGN SELF-TEST FAILED (sign error)");
    return false;
  }
  if (strcmp(sig, SELFTEST_GOLDEN_SIG) != 0) {
    Serial.printf("SIGN SELF-TEST FAILED  got=%s want=%s\n", sig, SELFTEST_GOLDEN_SIG);
    return false;
  }
  Serial.println("[SELFTEST] signing core OK");
  return true;
}

// =============================================================================
// BLE callbacks
// =============================================================================
class ServerCallbacks : public NimBLEServerCallbacks {
  void onConnect(NimBLEServer*, NimBLEConnInfo&) override {
    bleConnected = true;
    Serial.println("[BLE] phone connected");
    // Replay unacked events on connect: refresh BUFFER_CHAR so the app's first
    // read drains the pending ring, then the app writes back an ack.
    refreshBufferChar();
  }
  void onDisconnect(NimBLEServer*, NimBLEConnInfo&, int reason) override {
    bleConnected = false;
    Serial.printf("[BLE] phone disconnected (reason=%d). re-advertising\n", reason);
    NimBLEDevice::startAdvertising();
  }
};

// Handle an UNSIGNED set_time: anchor bootEpoch so events get real wall ts.
static void handleSetTime(uint32_t now) {
  if (now == 0) return;
  bootEpoch = now - (uint32_t)(millis() / 1000UL);
  prefs.putUInt("epoch", bootEpoch);
  Serial.printf("[TIME] set_time now=%u -> bootEpoch=%u\n", (unsigned)now, (unsigned)bootEpoch);
}

// Handle an UNSIGNED ack: app durably stored events up to seq; drop them.
static void handleAck(uint32_t seq) {
  if (seq > ackedSeq) {
    ackedSeq = seq;
    prefs.putUInt("acked", ackedSeq);
  }
  ringDropAcked();
  refreshBufferChar();
  Serial.printf("[ACK] ackedSeq=%u\n", (unsigned)ackedSeq);
}

class UnlockCallbacks : public NimBLECharacteristicCallbacks {
  void onWrite(NimBLECharacteristic* chr, NimBLEConnInfo&) override {
    std::string raw = chr->getValue();
    Serial.printf("[BLE] write: %s\n", raw.c_str());
    JsonDocument doc;
    if (deserializeJson(doc, raw)) { Serial.println("[BLE] JSON parse failed"); return; }

    String cmd = doc["cmd"] | "";

    // ---- UNSIGNED control commands -----------------------------------------
    if (cmd == "set_time") {
      handleSetTime((uint32_t)(doc["now"] | (uint32_t)0));
      return;
    }
    if (cmd == "ack") {
      handleAck((uint32_t)(doc["seq"] | (uint32_t)0));
      return;
    }

    // ---- SIGNED actuation commands: unlock / return_unlock -----------------
    String   sessionId = doc["session_id"]   | "";
    int      gate      = doc["gate"]          | 1;
    int      durMin    = doc["duration_min"]  | 0;
    uint32_t ts        = (uint32_t)(doc["ts"] | (uint32_t)0);
    String   sigHex    = doc["sig"]           | "";

    if (sigHex.length() == 0 || ts == 0) {
      Serial.println("[AUTH] missing ts/sig — rejecting");
      return;
    }
    if (gate < 1 || gate > NUM_GATES) {
      Serial.printf("[CMD] bad gate %d\n", gate);
      return;
    }
    if (!gKeyOk) { Serial.println("[AUTH] no key — rejecting"); return; }

    int g = gate - 1;
    // duration_min is signed-into the command for unlock; 0 for return_unlock.
    uint32_t signedDur = (cmd == "unlock") ? (uint32_t)durMin : 0;

    // Verify via the host-tested core, then enforce monotonic ts (replay guard).
    if (!playbox_verify_command(gKey, cmd.c_str(), gate, sessionId.c_str(),
                                signedDur, ts, sigHex.c_str())) {
      Serial.println("[AUTH] signature mismatch — rejecting");
      return;
    }
    if (ts <= lastTs) {
      Serial.printf("[AUTH] replay rejected ts=%u lastTs=%u\n", (unsigned)ts, (unsigned)lastTs);
      return;
    }
    lastTs = ts;
    prefs.putUInt("lastTs", lastTs);

    if (cmd == "unlock" && gateState[g] == LOCKED) {
      // Battery safety: at critical, REFUSE new unlocks (don't dispense on a
      // dying battery that may strand the next user). return_unlock is still
      // honored below so nobody is trapped with an item.
      if (batteryCritical) {
        Serial.printf("[CMD] unlock gate %d REFUSED — battery critical (%dmV)\n", gate, batteryMv);
        return;
      }
      activeSessionId[g] = sessionId;
      durationMin[g]     = (uint16_t)durMin;
      Serial.printf("[CMD] unlock gate %d session=%s dur=%umin\n", gate, sessionId.c_str(), durationMin[g]);
      servoOpen(g);
      transitionTo(g, UNLOCKED);
      // gate_opened carries the session_id.
      emitGateOpened(gate, activeSessionId[g]);
    } else if (cmd == "return_unlock" && gateState[g] == IN_USE && sessionId == activeSessionId[g]) {
      // Always allowed, even at battery_critical — never trap a user.
      Serial.printf("[CMD] return_unlock gate %d\n", gate);
      servoOpen(g);
      transitionTo(g, RETURN_UNLOCKED);
    } else {
      Serial.printf("[BLE] cmd '%s' gate %d ignored in state %s\n",
                    cmd.c_str(), gate, stateName(gateState[g]));
    }
  }
};

// =============================================================================
// Setup
// =============================================================================
void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.printf("\n=== Playbox 3-gate firmware (%s) ===\n", FW_VERSION);

  pinMode(LED_PIN, OUTPUT);

  // Decode the station secret once at boot.
  gKeyOk = (playbox_hex_decode_key(STATION_SECRET_HEX, gKey) == 0);
  if (!gKeyOk) Serial.println("[KEY] bad STATION_SECRET_HEX — events will be unsigned!");

  // Boot self-test BEFORE anything else trusts signing.
  if (!runSignSelfTest()) {
    blinkError();
    // Keep running so the unit is still diagnosable over Serial/BLE, but the
    // error blink + Serial line make a broken flash obvious.
  }

  // Servos: attach and drive to locked.
  for (int g = 0; g < NUM_GATES; g++) {
    servos[g].setPeriodHertz(50);
    servos[g].attach(SERVO_PINS[g], 500, 2400);
    servos[g].write(SERVO_LOCKED_DEG);
  }
  initReeds();

  // ADC for battery.
  analogReadResolution(12);
  analogSetPinAttenuation(BATTERY_ADC_PIN, ADC_11db);

  // NVS.
  prefs.begin("playbox", false);
  loadAll();
  for (int g = 0; g < NUM_GATES; g++) {
    stateEnteredMs[g] = millis();
    Serial.printf("[NVS] gate %d state=%s session='%s' dur=%u\n",
                  g + 1, stateName(gateState[g]), activeSessionId[g].c_str(), durationMin[g]);
  }
  Serial.printf("[NVS] seq=%u acked=%u epoch=%u lastTs=%u ring=%u\n",
                (unsigned)eventSeq, (unsigned)ackedSeq, (unsigned)bootEpoch,
                (unsigned)lastTs, (unsigned)ringCount());

  // Watchdog.
#if ESP_ARDUINO_VERSION_MAJOR >= 3
  esp_task_wdt_config_t wdtCfg = { .timeout_ms = WDT_TIMEOUT_S * 1000, .idle_core_mask = 0, .trigger_panic = true };
  esp_task_wdt_init(&wdtCfg);
#else
  esp_task_wdt_init(WDT_TIMEOUT_S, true);
#endif
  esp_task_wdt_add(NULL);

  // BLE.
  NimBLEDevice::init("Playbox-" STATION_ID);
  NimBLEServer* server = NimBLEDevice::createServer();
  server->setCallbacks(new ServerCallbacks());
  NimBLEService* service = server->createService(SERVICE_UUID);

  NimBLECharacteristic* unlockChar =
    service->createCharacteristic(UNLOCK_CHAR_UUID, NIMBLE_PROPERTY::WRITE);
  unlockChar->setCallbacks(new UnlockCallbacks());

  eventsChar = service->createCharacteristic(EVENTS_CHAR_UUID, NIMBLE_PROPERTY::NOTIFY);
  infoChar   = service->createCharacteristic(INFO_CHAR_UUID,   NIMBLE_PROPERTY::READ);
  bufferChar = service->createCharacteristic(BUFFER_CHAR_UUID, NIMBLE_PROPERTY::READ);

  refreshInfoChar();
  refreshBufferChar();

  service->start();
  NimBLEAdvertising* adv = NimBLEDevice::getAdvertising();
  adv->addServiceUUID(SERVICE_UUID);
  adv->setName("Playbox-" STATION_ID);
  adv->start();
  Serial.println("[BLE] advertising as 'Playbox-" STATION_ID "'");

  // Prime a battery read so INFO is populated before the first sample window.
  batteryMv  = readBatteryMvOnce();
  batteryPct = mvToSoc(batteryMv);
  batteryCritical = (batteryMv <= BATTERY_CRIT_MV);
  refreshInfoChar();

  emitBoot();
}

// =============================================================================
// Loop
// =============================================================================
unsigned long lastHeartbeat = 0;

void loop() {
  esp_task_wdt_reset();

  if (millis() - lastHeartbeat > 1000) {
    digitalWrite(LED_PIN, !digitalRead(LED_PIN));
    lastHeartbeat = millis();
  }

  tickServos();
  pollReeds();
  checkTimeouts();
  sampleBattery();

  delay(5);
}
