# Relay/solenoid door actuation — design

Date: 2026-06-12
Status: approved, ready to implement

## Goal

Replace the gate **servo** actuation in the station firmware with a **4-channel
relay board driving a solenoid latch**, so renting a ball pops the door open
("psst") and the user closes it by hand. No app or server changes.

## Why no app/server change

The rent → open flow already exists end-to-end:

```
user taps "oyna" (play)  →  app/session-prep/[stationId]/[sport].tsx onOyna()
  →  driver.unlockGate()            (lib/hardware/ble.ts)
  →  server signs unlock (HMAC-SHA256, /functions/v1/sign-unlock)
  →  app writes signed cmd over BLE to the ESP32
  →  firmware verifies sig → OPENS the gate → emits "gate_opened"
```

Both door-open moments are already in firmware:
- `unlock` command  → rent / start of session
- `return_unlock` command → end of session (return the ball)

Both already call the open function. We only change **how** "open" actuates the
hardware: servo angle → relay pulse.

## Hardware

- 4-channel relay board, **ACTIVE-LOW**: driving the IN pin **LOW** energizes the
  relay (confirmed — tapping IN1 to breadboard GND fires the solenoid).
- One solenoid wired today on **gate 0**.
- Relay IN1 → **ESP32 GPIO 13** (the pin the firmware already used for the servo).
- Solenoid powered from its own supply through the relay's NO contact — never off
  the ESP32 rail.

## Behaviour

- **Idle / locked:** GPIO 13 held **HIGH** (relay OFF). Door held shut by the
  mechanical latch. Pin set HIGH the instant it becomes an OUTPUT at boot so the
  relay never clicks on during startup.
- **Open (rent or return):** drive GPIO 13 **LOW for 400 ms** (the "psst"), then
  back **HIGH**. One momentary kick releases the latch; the door springs open and
  the user closes it again (latch re-grabs mechanically).
- The relay **always** returns to OFF after the pulse, regardless of gate state —
  an active-low relay left energized would overheat the solenoid. (This differs
  from the old servo `tickServos`, which only re-asserted when state == LOCKED.)

## Implementation

Reuse the existing non-blocking relax timer so `open` stays non-blocking:
`servoRelaxMs[]` → `relayOffMs[]`, `tickServos()` → `tickRelays()` (called from
`loop()`), `anyServoActive()` → `anyRelayActive()` (still used to skip battery
ADC reads while the rail is loaded mid-pulse).

Rename the three actuation functions for honesty:
- `servoOpen(g)`  → `relayOpen(g)`   (pulse LOW, arm off-timer)
- `servoLock(g)`  → `relayLock(g)`   (drive OFF, clear timer)
- `tickServos()`  → `tickRelays()`   (drop relay OFF when pulse elapses)

Remove `#include <ESP32Servo.h>`, the `Servo servos[]` array, `ESP32PWM::
allocateTimer`, the servo `attach()` setup, and the post-NVS "re-assert servo to
restored state" block (a momentary relay has nothing to re-assert — it just stays
OFF; the latch state is mechanical).

New constants:

```c
static const uint8_t RELAY_PINS[NUM_GATES] = { 13 };   // 3gate: { 13, 12, 14 }
#define RELAY_ON   LOW      // active-low board: LOW = energized
#define RELAY_OFF  HIGH
#define RELAY_PULSE_MS 400UL
```

### Files

- `firmware/PlayboxStation/PlayboxStation.ino` — single gate (bench unit). Primary.
- `firmware/PlayboxStation_3gate/PlayboxStation_3gate.ino` — mirror the change for
  3 channels (IN pins 13 / 12 / 14).
- `firmware/README.md` — update the wiring note (servo → relay).

### 3-gate caveat (not blocking today)

Gate 2 on the 3-gate board is **GPIO 12**, an ESP32 strapping pin that must read
LOW at boot for the correct internal flash voltage. An idle-HIGH active-low relay
on GPIO 12 can disturb boot. Only gate 0 (GPIO 13) is wired now, so this does not
affect the bench unit. When the other channels are wired, either move gate 2 off
GPIO 12 (e.g. GPIO 27) or add an external pulldown. Flagged in code + README.

## Out of scope

- App, server, BLE protocol, signing, reed/door-sensor logic, battery, events —
  all untouched.
- Multi-solenoid wiring (only one channel populated today).

## Verification

- Flash bench unit. Confirm relay does **not** click at boot.
- Trigger a rent from the app (or a signed `unlock`): relay snaps for ~400 ms,
  solenoid fires, door pops; relay returns OFF. Serial shows `[RELAY] gate 1 ->
  PULSE OPEN`.
- End session / `return_unlock`: door pops again.
- Confirm `gate_opened` event still emits and the app's session starts.
