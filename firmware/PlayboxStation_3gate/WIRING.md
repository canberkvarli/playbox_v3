# Playbox 3-gate hardware wiring

Driver path: **TLS Robotik 4-channel optocoupler relay (active-LOW)**. The ESP32 doesn't switch the 12V — the relay does. The relay module handles flyback internally and is optically isolated from the MCU, so no MOSFETs or external diodes are needed.

## Pin map (ESP32 NodeMCU-32S)

| Function | GPIO | Notes |
|---|---|---|
| Heartbeat LED | 2 | Onboard blue LED |
| Solenoid 1 (Football) | 13 | → Relay IN1 (active-LOW) |
| Solenoid 2 (Basketball) | 12 | → Relay IN2 (active-LOW) |
| Solenoid 3 (Volleyball) | 14 | → Relay IN3 (active-LOW) |
| (Relay IN4) | — | Unused / spare |
| Reed switch 1 | 18 | INPUT_PULLUP, magnet near = LOW |
| Reed switch 2 | 19 | INPUT_PULLUP, magnet near = LOW |
| Reed switch 3 | 21 | INPUT_PULLUP, magnet near = LOW |

Reed switches are optional during bench bring-up — the firmware compiles and the unlock path works without them, but the return flow (IN_USE → RETURN_UNLOCKED → LOCKED) needs reeds to detect door-closed. Wire them before soft-launch.

## Power split

```
12V battery ──┬── fuse ──┬── rocker switch ──┬── LM2596 buck → 5V → ESP32 VIN
              │          │                    │
              │          │                    └── +12V rail ─→ relay COM (each channel)
              │          │
              │          └── (optional) battery monitor / ADC
              │
              └── shared GND ── ESP32 GND ── relay GND ── solenoid (-) return
```

The relay module's logic side is powered separately: tie its `VCC` to ESP32 5V and its `GND` to the common ground. The relay's switched side (COM/NO terminals) carries the raw 12V to the solenoid.

## Per-channel wiring (x3)

```
ESP32 GPIO 13 ─────────── Relay IN1   ┐
ESP32 5V    ─────────── Relay VCC     │ logic side
ESP32 GND   ─────────── Relay GND     ┘

+12V rail   ─────────── Relay COM1    ┐
Relay NO1   ─────────── Solenoid 1 (+) │ switched side
Solenoid 1 (-) ──────── GND (12V return) ┘
```

When the firmware drives GPIO 13 **LOW**, the optocoupler energises the relay coil, COM1 connects to NO1, +12V flows through the solenoid, the latch retracts, the gas strut pops the door. After 300ms the firmware drives GPIO 13 **HIGH**, the relay drops out, the solenoid de-energises, the spring re-engages the latch ready for the next close.

## Boot safety

GPIO 13, 12, 14 are not boot-mode straps — safe to use as outputs. On reset, the firmware sets them HIGH **before** `pinMode(OUTPUT)` so the relay never sees a glitch LOW during the few microseconds the pin defaults to LOW.

## Reed switch wiring (per gate, x3)

```
ESP32 GPIO (e.g. 18) ──────── one leg of reed switch
                                          │
GND ────────────────────────────────── other leg
```

INPUT_PULLUP in firmware. Magnet near → switch closes → GPIO reads LOW = "door closed". No magnet → switch open → pullup pulls HIGH = "door open".

## Power budget

- ESP32: 5V from LM2596 buck, ~150 mA peak
- Relay logic: 5V from same buck, ~20 mA per energised channel
- Solenoids: 12V direct from battery via relay NO/COM, ~1 A inrush per solenoid for 300 ms during pulse, 0 the rest of the time
- Reed switches: passive, no power draw

Sizing: a 12V 7 Ah battery handles many hundreds of unlock cycles per charge. The brief solenoid pulses are negligible; the buck + ESP32 idle current dominate.

## Common ground

ESP32 GND, relay GND, buck output GND, and the solenoid 12V return must all share a common GND. The optocoupler isolates the logic SIDE from the COIL side, but for the logic level itself to be valid you still need ESP32 GND ↔ relay GND ↔ buck GND tied together.
