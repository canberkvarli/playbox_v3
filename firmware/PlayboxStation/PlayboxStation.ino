// =============================================================================
// Playbox Station — Phase 0 firmware (breadboard smoke test)
// =============================================================================
// Hardware:
//   - ESP32 WROOM-32 (board: "ESP32 Dev Module")
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
// Wire format matches lib/ble/protocol.ts in the Playbox app.
// =============================================================================

#include <NimBLEDevice.h>
#include <ArduinoJson.h>
#include <ESP32Servo.h>

// ---- Pins -------------------------------------------------------------------
#define LED_PIN     2
#define BUTTON_PIN  0   // BOOT button on most ESP32 DevKits (active LOW)
#define SERVO_PIN   13

// ---- Servo angles -----------------------------------------------------------
#define ANGLE_LOCKED    0
#define ANGLE_UNLOCKED  90

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

    String cmd        = doc["cmd"]        | "";
    String sessionId  = doc["session_id"] | "";
    int    gate       = doc["gate"]       | 1;

    if (cmd == "unlock" && gateState == LOCKED) {
      Serial.printf("[STATE] %s -> UNLOCKED (session %s)\n", stateName(gateState), sessionId.c_str());
      gateServo.write(ANGLE_UNLOCKED);
      gateState = UNLOCKED;
      activeSessionId = sessionId;
    } else if (cmd == "return_unlock" && gateState == IN_USE && sessionId == activeSessionId) {
      Serial.printf("[STATE] %s -> RETURN_UNLOCKED\n", stateName(gateState));
      gateServo.write(ANGLE_UNLOCKED);
      gateState = RETURN_UNLOCKED;
    } else {
      Serial.printf("[BLE] cmd '%s' ignored in state %s\n", cmd.c_str(), stateName(gateState));
    }
  }
};

// ---- Setup ------------------------------------------------------------------
void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("\n=== Playbox Phase 0 firmware (v0.1.0-phase0) ===");

  pinMode(LED_PIN, OUTPUT);
  pinMode(BUTTON_PIN, INPUT_PULLUP);

  ESP32PWM::allocateTimer(0);
  gateServo.setPeriodHertz(50);
  gateServo.attach(SERVO_PIN, 500, 2400);
  gateServo.write(ANGLE_LOCKED);
  Serial.println("[INIT] servo at 0deg (LOCKED)");

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
  info["fw"]          = "0.1.0-phase0";
  info["gates"]       = 1;
  info["battery_pct"] = 100;
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
  // Heartbeat LED — toggle every 1s so you can see the loop is alive
  if (millis() - lastHeartbeat > 1000) {
    digitalWrite(LED_PIN, !digitalRead(LED_PIN));
    lastHeartbeat = millis();
  }

  // BOOT button polling with 50ms debounce — fake reed switch
  int btn = digitalRead(BUTTON_PIN);
  if (btn != lastBtn && (millis() - lastBtnChangeMs) > 50) {
    lastBtn = btn;
    lastBtnChangeMs = millis();

    if (btn == LOW) {  // button pressed (active LOW) = "gate closed"
      if (gateState == UNLOCKED) {
        Serial.println("[BTN] gate closed after pickup — UNLOCKED -> IN_USE");
        gateServo.write(ANGLE_LOCKED);
        gateState = IN_USE;
        // No event emitted: taking the ball isn't a session end
      } else if (gateState == RETURN_UNLOCKED) {
        Serial.println("[BTN] gate closed after return — RETURN_UNLOCKED -> LOCKED (session ends)");
        gateServo.write(ANGLE_LOCKED);
        emitGateClosed(1, activeSessionId);
        activeSessionId = "";
        gateState = LOCKED;
      } else {
        Serial.printf("[BTN] press ignored in state %s\n", stateName(gateState));
      }
    }
  }

  delay(10);
}
