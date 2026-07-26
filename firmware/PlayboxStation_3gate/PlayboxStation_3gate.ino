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
// HARDWARE
//   - 4-channel relay board (ACTIVE-LOW) driving a solenoid latch per gate:
//     Gate1 IN1 GPIO 13, Gate2 IN2 GPIO 12, Gate3 IN3 GPIO 14. Open = momentary
//     ~400ms LOW pulse; idle = HIGH (relay off). Solenoids run off a separate
//     supply through the relay NO contacts, GND shared with the ESP32. NEVER
//     drive a solenoid off the ESP32 rail. NOTE: GPIO 12 (gate 2) is a boot
//     strapping pin — see the RELAY_PINS comment before wiring that channel.
//   - 3x reed switches (door-closed sensors): Gate1 GPIO 18, Gate2 GPIO 19,
//     Gate3 GPIO 21. Wired GPIO↔GND, INPUT_PULLUP. LOW = magnet near = closed.
//   - Battery sense: ADC divider on GPIO 34 (input-only ADC1 pin). See
//     BATTERY section for the ~5:1 divider + calibration notes.
//   - Onboard LED GPIO 2 (heartbeat blink; also self-test error pattern).
//
// State machine (per gate, independent):
//   LOCKED          --(unlock)----------->  UNLOCKED        relay pulses open
//   UNLOCKED        --(reed: closed)----->  IN_USE          user took item
//   IN_USE          --(return_unlock)---->  RETURN_UNLOCKED relay pulses open
//   RETURN_UNLOCKED --(reed: closed)----->  LOCKED          emits gate_closed
//
// -----------------------------------------------------------------------------
// BUILD NOTE: the Arduino IDE/CLI compiles every source in the sketch root, so
// the four signing-core files are kept FLAT in this folder (NOT a crypto/
// subdir — Arduino does not compile arbitrary subfolders):
//     playbox_sign.c   playbox_sign.h   sha256.c   sha256.h
// They are copies of the canonical, host-tested core in firmware/crypto/ (which
// firmware/test/run.sh validates against the server golden vectors). Do not edit
// them here — change firmware/crypto/ and re-copy if the contract ever moves.
// =============================================================================

#include <string.h>   // strcmp — used to gate the battery-mv field by event name
#include <NimBLEDevice.h>
#include <ArduinoJson.h>
#include <Preferences.h>
#include <esp_task_wdt.h>

extern "C" {
  #include "playbox_sign.h"   // canonical builders + sign/verify (host-tested; flat in sketch root)
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
// Real secret lives in station_secret.h (gitignored — copy from
// station_secret.example.h). MUST equal Supabase PLAYBOX_STATION_SECRET_DEV_001.
#include "station_secret.h"

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
// 4-channel relay board (ACTIVE-LOW) driving one solenoid latch per gate.
// Relay INx -> these pins. Open = momentary LOW pulse; idle = HIGH (relay off).
// Gate 2 was moved OFF GPIO 12 -> GPIO 27. GPIO 12 is an ESP32 strapping pin
// that must read LOW at boot for the correct flash voltage; an idle-HIGH
// active-low relay on it can block boot. GPIO 27 is a safe general-purpose
// output, as are GPIO 13 (gate 1) and GPIO 14 (gate 3).
static const uint8_t RELAY_PINS[NUM_GATES] = { 13, 27, 14 };
static const uint8_t REED_PINS[NUM_GATES]  = { 18, 19, 21 };

// Battery ADC: ADC1 input-only pin (safe alongside WiFi/BLE, unlike ADC2).
#define BATTERY_ADC_PIN 34

// ---- Relay (solenoid) timing ------------------------------------------------
#define RELAY_ON        LOW       // active-low board: LOW = relay energized
#define RELAY_OFF       HIGH      // idle / locked: relay de-energized
#define RELAY_PULSE_MS  400UL     // momentary "psst" that throws the latch — long enough to pull in, short enough to stay cool
#define UNLOCKED_TIMEOUT_MS        300000UL // user didn't take ball (5min, bench-friendly)
#define RETURN_UNLOCKED_TIMEOUT_MS  60000UL // user didn't return ball
#define WDT_TIMEOUT_S       30
#define DEFAULT_DURATION_MIN 30
#define REED_DEBOUNCE_MS    50

// Dev unit only: honor the UNSIGNED `sim_close` command (the app's "KAPAT (sim)"
// button / bench), a stand-in for the reed door-closed edge so the full
// rent→close→return→close cycle runs before reeds are wired. Set to 0 for
// production firmware so a phone can never fake a door-closed.
#define DEV_SIM_CLOSE 1

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
// constant absorbs that too. READ AT REST — never during a relay pulse (the
// inrush sags the rail and would falsely trip battery_low/critical).
#define BATTERY_DIVIDER     4.9f
#define ADC_VREF            3.30f
#define ADC_MAX             4095.0f
#define BATTERY_LOW_MV      11900   // ≈40% SoC — emit battery_low (signed, +mv)
#define BATTERY_CRIT_MV     11500   // ≈20% SoC — emit battery_critical + refuse unlock
#define BATTERY_HYST_MV     150     // re-arm hysteresis so we emit once per crossing
#define BATTERY_SAMPLE_MS   30000UL // sample cadence (also gates emit-once logic)

// Set to 1 ONLY after the ~5:1 divider on GPIO34 is actually wired + calibrated.
// Leave 0 (bench default): with no divider, GPIO34 floats and reads a garbage-low
// "rail" -> firmware thinks battery_critical -> EVERY unlock is REFUSED (see the
// unlock handler). When 0, readBatteryMvOnce() returns BATTERY_FULL_MV instead of
// touching the pin, so battery stays "full": no battery_low/critical events and
// unlocks are never gated on battery.
#define BATTERY_ADC_WIRED 0
#define BATTERY_FULL_MV   12700   // healthy rail reported when BATTERY_ADC_WIRED == 0

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

// Relay pulse off-timers (0 = relay idle/OFF, non-zero = millis() to drop OFF).
unsigned long relayOffMs[NUM_GATES] = { 0 };

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
// INFO characteristic — CANONICAL INFO SHAPE (do not let this drift again).
// -----------------------------------------------------------------------------
// There are TWO app-side parsers with DIFFERENT expectations. `gates` MUST be a
// NUMBER (count) and we emit a SUPERSET so both parsers are satisfied:
//
//   Field          Type                          Read by
//   ------------   ---------------------------   ----------------------------------
//   station_id     string                        (general)
//   fw             string                        app/station/[id].tsx (info.fw)
//   gates          NUMBER (gate count, == 3)     app/station/[id].tsx (info.gates,
//                                                 numeric) + general. NEVER an array.
//   battery_pct    number                        (general / dashboards)
//   battery_mv     number                        (general / dashboards)
//   gate_states    string[]  per-gate state      lib/hardware/infoGate.ts shape (a):
//                                                 extractGate() reads gate_states[idx]
//   gate_sessions  string[]  per-gate session     lib/hardware/infoGate.ts shape (a):
//                                                 extractGate() reads gate_sessions[idx]
//   states         object[]  {gate,state,         app/station/[id].tsx: iterates
//                            session_id,door}      info.states, keys by obj.gate
//
// gate_states[i] / states[i] describe gate i+1. State strings are exactly the 4
// valid GateState values: LOCKED | UNLOCKED | IN_USE | RETURN_UNLOCKED. session
// is "" when there is no active session for that gate.
//
// NOTE: gate_states/gate_sessions (parallel string arrays) are what infoGate.ts
// reads (shape a). `states` is the object array the dev station screen reads.
// Both carry the SAME per-gate data — keep both in sync.
//
// KEEP THIS BLOB SMALL. It is fetched over BLE, where a single attribute is
// capped at 512 bytes and anything past the negotiated MTU costs extra READ
// BLOB round trips — the most drop-prone operation on the link (symptom: an
// empty INFO value, or a disconnect mid-read). The `sessions` alias,
// `gate_doors`, and `states[].door_closed` were removed for this reason: all
// three were pure duplication with ZERO readers in the app (verified by
// grep). Before adding a field, check something actually reads it.
//
// Rebuilt on every state/battery change so a fresh READ always reflects truth.
// =============================================================================
static void refreshInfoChar() {
  if (!infoChar) return;
  JsonDocument info;
  info["station_id"]  = STATION_ID;
  info["fw"]          = FW_VERSION;
  info["gates"]       = NUM_GATES;          // NUMBER (count) — never an array
  info["battery_pct"] = batteryPct;
  info["battery_mv"]  = batteryMv;

  // Parallel string arrays — infoGate.ts shape (a).
  JsonArray gateStates   = info["gate_states"].to<JsonArray>();
  JsonArray gateSessions = info["gate_sessions"].to<JsonArray>();
  // Physical DOOR state from the reed, parallel to the arrays above. LOW =
  // magnet near = "closed"; HIGH (or no reed wired → INPUT_PULLUP) = "open".
  // The app reads this to gate the open/return button: you can only open a door
  // that's actually shut, and you can't "open" one already hanging open.
  // Object array read by app/station/[id].tsx (info.states).
  JsonArray states = info["states"].to<JsonArray>();

  for (int g = 0; g < NUM_GATES; g++) {
    const char* st  = stateName(gateState[g]);
    const String& sid = activeSessionId[g];
    const bool doorClosed = (lastReed[g] == LOW);
    const char* door = doorClosed ? "closed" : "open";
    gateStates.add(st);
    gateSessions.add(sid);
    JsonObject go = states.add<JsonObject>();
    go["gate"]        = g + 1;
    go["state"]       = st;
    go["session_id"]  = sid;
    go["door"]        = door;         // "closed" | "open" (from the reed)
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
// Relay actuation (non-blocking momentary pulse)
// =============================================================================
static void relayOpen(int g) {
  // Momentary kick: energize the relay now, arm the off-timer for tickRelays().
  digitalWrite(RELAY_PINS[g], RELAY_ON);
  relayOffMs[g] = millis() + RELAY_PULSE_MS;
  Serial.printf("[RELAY] gate %d -> PULSE OPEN (%lums)\n", g + 1, RELAY_PULSE_MS);
}

static void relayLock(int g) {
  digitalWrite(RELAY_PINS[g], RELAY_OFF);
  relayOffMs[g] = 0;
  Serial.printf("[RELAY] gate %d -> LOCKED (relay off)\n", g + 1);
}

static void tickRelays() {
  // End the momentary pulse: always drop the relay back OFF once the pulse
  // window elapses. The latch is mechanical — the door stays open after the
  // kick; leaving an active-low relay energized would overheat the solenoid.
  for (int g = 0; g < NUM_GATES; g++) {
    if (relayOffMs[g] != 0 && (long)(millis() - relayOffMs[g]) >= 0) {
      relayOffMs[g] = 0;
      digitalWrite(RELAY_PINS[g], RELAY_OFF);
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
    durationMin[g] = DEFAULT_DURATION_MIN;
    overdueSent[g] = false;
    relayLock(g);
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
      // NOTE: intentionally do NOT rebuild INFO here. Doing it on every reed
      // edge churned the BLE stack (heap alloc + serialize in loop()) and, when
      // a noisy reed chattered, destabilized connection setup → "online but
      // won't connect". INFO still carries door state — refreshed on every state
      // transition, on boot, and on the app's on-demand read (lastReed is always
      // current), which is enough for the dev badge without the per-edge churn.
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
#if !BATTERY_ADC_WIRED
  // No divider wired (bench): never read the floating ADC pin. Report a healthy
  // rail so all battery logic stays inert — no events, no unlock gating.
  return BATTERY_FULL_MV;
#else
  // analogRead at 11dB attenuation maps ~0..3.3V to 0..4095. Scale back through
  // the divider to the rail in millivolts.
  int raw = analogRead(BATTERY_ADC_PIN);
  float vpin = (raw / ADC_MAX) * ADC_VREF;
  float vrail = vpin * BATTERY_DIVIDER;
  return (int)(vrail * 1000.0f);
#endif
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

// Whether any gate is mid-relay-pulse — skip battery reads then (rail sags).
static bool anyRelayActive() {
  for (int g = 0; g < NUM_GATES; g++) if (relayOffMs[g] != 0) return true;
  return false;
}

static void sampleBattery() {
  if (millis() - lastBatterySampleMs < BATTERY_SAMPLE_MS) return;
  if (anyRelayActive()) return;   // read at rest only
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
  void onConnect(NimBLEServer* pServer, NimBLEConnInfo& connInfo) override {
    bleConnected = true;
    Serial.println("[BLE] phone connected");
    // Ask the phone for a STICKY link immediately. Without this we inherit the
    // central's (iOS's) aggressive defaults and the connection drops with
    // reason=520 (supervision timeout) the moment a few connection events are
    // missed — even with the ESP32 fully powered. We request a 30–50ms interval,
    // ZERO slave latency (never skip a listen window — our flow is notify-heavy),
    // and a long 5s supervision timeout so a brief RF hiccup no longer tears the
    // link down. Units: interval = 1.25ms steps, timeout = 10ms steps. These are
    // Apple-compliant (interval >= 15ms, max >= min+15ms, timeout <= 6s).
    pServer->updateConnParams(connInfo.getConnHandle(),
                              /*minInterval=*/24,   // 30 ms
                              /*maxInterval=*/40,   // 50 ms
                              /*latency=*/0,
                              /*timeout=*/500);     // 5000 ms supervision
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

#if DEV_SIM_CLOSE
    // UNSIGNED, DEV ONLY: stand-in for the reed/door-closed edge so the full
    // unlock→close→return→close cycle can be driven from the app's "KAPAT (sim)"
    // button (or bench) before reeds are wired. Same effect as a real reed close
    // on that gate (UNLOCKED→IN_USE, or RETURN_UNLOCKED→LOCKED + gate_closed).
    // A production build (DEV_SIM_CLOSE 0) ignores it entirely.
    if (cmd == "sim_close") {
      int simGate = doc["gate"] | 1;
      if (simGate >= 1 && simGate <= NUM_GATES) {
        Serial.printf("[SIM] sim_close gate %d\n", simGate);
        handleGateClose(simGate - 1);
      }
      return;
    }
#endif

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
      relayOpen(g);
      transitionTo(g, UNLOCKED);
      // gate_opened carries the session_id.
      emitGateOpened(gate, activeSessionId[g]);
    } else if (cmd == "return_unlock" && gateState[g] == IN_USE && sessionId == activeSessionId[g]) {
      // Always allowed, even at battery_critical — never trap a user.
      Serial.printf("[CMD] return_unlock gate %d\n", gate);
      relayOpen(g);
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
  // Brownout detector LEFT ENABLED (default). We previously disabled it to stop
  // "random BLE drops", but that was the wrong fix: the drops came from the
  // +9 dBm TX current spike (now removed). Disabling the detector turned a
  // recoverable voltage sag into an unrecoverable HANG — the chip stopped
  // advertising and only a power cycle brought it back ("not found within
  // 8000ms"). Enabled, a genuine sag cleanly RESETS the chip and setup()
  // re-starts advertising on its own — self-healing, no power cycle needed.

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

  // Relay outputs: preset the latch HIGH (RELAY_OFF) BEFORE pinMode(OUTPUT).
  // ESP32 records a digitalWrite into the output latch even while the pin is
  // still an input, so by the time pinMode(OUTPUT) enables the driver the pin
  // is already driving HIGH. Doing it the other way round (pinMode first) lets
  // the default-LOW latch drive the pin LOW for a few microseconds — which an
  // active-low relay board reads as "ON" and clicks every solenoid at boot.
  for (int g = 0; g < NUM_GATES; g++) {
    digitalWrite(RELAY_PINS[g], RELAY_OFF);  // preset latch while still input
    pinMode(RELAY_PINS[g], OUTPUT);          // becomes output already-HIGH
    digitalWrite(RELAY_PINS[g], RELAY_OFF);  // confirm once the driver is on
  }
  initReeds();

  // ADC for battery.
  analogReadResolution(12);
  // analogSetPinAttenuation takes the Arduino-core `adc_attenuation_t` enum
  // (ADC_0db / ADC_2_5db / ADC_6db / ADC_11db) — NOT the ESP-IDF `adc_atten_t`
  // (ADC_ATTEN_DB_12). ADC_11db is the ~0..3.3V full-scale range and is the
  // correct name on esp32 Arduino core v2 AND v3 (verified compiling on 3.3.8).
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
  // NOTE: we deliberately do NOT crank TX power. Setting +9 dBm (the old
  // "range boost") spikes the peak current on this DevKit's marginal
  // AMS1117 rail during each TX burst. With the brownout detector disabled
  // (which we also had done) that sag no longer produced a clean reset — the
  // chip HUNG and stopped advertising entirely, so the phone reported
  // "Playbox-DEV-001 not found within 8000ms" until a power cycle. A crashed
  // radio is a silent radio: louder-but-hung is worse than quieter-but-alive.
  // Leaving TX at the NimBLE default (~+3 dBm) is the known-good, findable state.
  //
  // Ask for a LARGE MTU. INFO is a ~350-500 byte JSON blob; over a small MTU the
  // phone must fetch it with a chain of sequential ATT READ BLOB round trips.
  // That chain is the single heaviest, longest-airtime thing this link ever
  // does, and if the link dies partway the app sees an EMPTY value ("INFO
  // characteristic returned no value / board still booting?") or an outright
  // mid-read disconnect. With a 517-byte MTU the whole blob lands in ONE
  // exchange: less airtime, less current, far fewer chances to drop. This is a
  // request — the phone negotiates down to what it supports (iOS caps ~185),
  // so it is safe and never larger than both sides agree on.
  NimBLEDevice::setMTU(517);
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
  // Build the PRIMARY advertising packet EXPLICITLY so the name is GUARANTEED to
  // be broadcast. We previously relied on adv->setName(), but in NimBLE 2.x that
  // places the name in the SCAN RESPONSE by default — and our custom
  // setScanResponseData() below (UUID only) then OVERWROTE it, so the name was
  // broadcast NOWHERE. iOS and nRF Connect still SHOWED "Playbox-DEV-001" from
  // their per-peripheral name CACHE (a past session), which masked the bug — but
  // a fresh phone scan saw hundreds of adverts with NO Playbox name and never
  // matched (app diagnostic: "386 cihaz görüldü, Playbox adı yok"). Putting the
  // name in the primary packet (flags + 15-char name ≈ 20 bytes) fits the 31-byte
  // budget with room to spare and is what iOS surfaces as the advertised name.
  NimBLEAdvertisementData advData;
  advData.setFlags(0x06);  // LE General Discoverable + BR/EDR not supported
  advData.setName("Playbox-" STATION_ID);
  adv->setAdvertisementData(advData);
  // 128-bit service UUID goes in the SCAN RESPONSE — it won't fit alongside the
  // name in the 31-byte primary. NimBLE 2.x no longer enables scan response by
  // default (1.x→2.x migration guide), so enable it explicitly.
  NimBLEAdvertisementData scanData;
  scanData.addServiceUUID(SERVICE_UUID);
  adv->setScanResponseData(scanData);
  adv->enableScanResponse(true);
  // Advertise FAST (20-40ms) so a cold iPhone discovers us on the FIRST OYNA
  // tap. NimBLE's default interval is ~1.28s — far too slow: iOS often doesn't
  // hear the first advert inside the app's 8s scan window, so the first tap
  // fails with "not in range" and only the second (now-cached) tap connects.
  // Units are 0.625ms: 0x20=32→20ms, 0x40=64→40ms. The station is USB/mains
  // powered, so the extra radio duty cost is irrelevant.
  adv->setMinInterval(0x20);
  adv->setMaxInterval(0x40);
  adv->start();
  Serial.println("[BLE] advertising as 'Playbox-" STATION_ID "' (name in primary, UUID in scan-rsp)");

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

  // Onboard LED = BLE link indicator you can read on battery, no USB/serial:
  //   SOLID ON  = a phone is connected (GATT link up)
  //   SLOW BLINK (1 Hz) = advertising / idle, nobody connected
  // This turns "did the connect reach the ESP32?" into a glance: tap connect
  // and watch — if it never goes solid, the phone isn't reaching the board
  // (app/RF); if it goes solid then blinks again, the link formed then dropped
  // (supervision/RF/ESP32 side).
  if (bleConnected) {
    digitalWrite(LED_PIN, HIGH);
    lastHeartbeat = millis();  // so the blink resumes cleanly on disconnect
  } else if (millis() - lastHeartbeat > 1000) {
    digitalWrite(LED_PIN, !digitalRead(LED_PIN));
    lastHeartbeat = millis();
  }

  tickRelays();
  pollReeds();
  checkTimeouts();
  sampleBattery();

  delay(5);
}
