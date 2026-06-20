# Playbox 3-gate hardware wiring

Driver path: **TLS Robotik 4-channel optocoupler relay (active-LOW)**. The ESP32 doesn't switch the 12V — the relay does. The relay module is optically isolated from the MCU (no MOSFET or level shifter needed on the logic side), and it has its own internal diode across the relay coil.

**It does NOT protect the solenoid.** The solenoid is an inductive load on the relay's mechanical contacts. When the relay opens, the solenoid's back-EMF arcs across the contacts (degrades them over time) and can radiate enough noise to glitch or reset the ESP32. You must add one flyback diode across each solenoid coil. See "Flyback diodes" below.

## Pin map (ESP32 NodeMCU-32S)

| Function | GPIO | Notes |
|---|---|---|
| Heartbeat LED | 2 | Onboard blue LED |
| Solenoid 1 (Football) | 13 | → Relay IN1 (active-LOW) |
| Solenoid 2 (Basketball) | 27 | → Relay IN2 (active-LOW). Moved off GPIO 12 — see Boot safety. |
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

When the firmware drives GPIO 13 **LOW**, the optocoupler energises the relay coil, COM1 connects to NO1, +12V flows through the solenoid, the latch retracts, and the spring plunger pops the door open. After 800ms (`RELAY_PULSE_MS`) the firmware drives GPIO 13 **HIGH**, the relay drops out, the solenoid de-energises, and the latch is ready to re-engage when the user pushes the door closed.

## Flyback diodes (one per solenoid, x3)

```
              ┌──────|◄──────┐        |◄ = diode, band (cathode) on the +12V side
              │   (1N4007)   │
+12V (NO) ────┴── Solenoid ──┴──── GND (12V return)
```

Diode sits directly across the two solenoid terminals, reverse-biased in normal operation:
- **cathode (banded end) → solenoid +12V side** (the relay NO terminal side)
- **anode → solenoid GND side**

In normal operation it does nothing. When the relay opens and the solenoid's field collapses, the back-EMF forward-biases the diode and the coil current loops through it instead of arcing the relay contacts. Mount the diode at the solenoid, not at the relay. 1N4007 (or 1N5819 Schottky) is fine for the ~1A pulse.

## Boot safety

GPIO 13 and 14 are not boot-mode straps — safe as outputs. **GPIO 12 IS a strapping pin** (flash voltage select): if it is held HIGH at boot, the ESP32 may fail to start. The active-LOW relay idles its input HIGH, which is exactly the risk. So **solenoid 2 is on GPIO 27, not 12** — already set in firmware: `RELAY_PINS = {13, 27, 14}`. (GPIO 27/32/33 are all safe alternatives if you ever re-pin.)

On reset, the firmware sets all relay pins HIGH **before** `pinMode(OUTPUT)` so the relay never sees a glitch LOW during the few microseconds the pin defaults to LOW.

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
- Solenoids: 12V direct from battery via relay NO/COM, ~1 A inrush per solenoid for 800 ms during pulse, 0 the rest of the time
- Reed switches: passive, no power draw

Sizing: a 12V 7 Ah battery handles many hundreds of unlock cycles per charge. The brief solenoid pulses are negligible; the buck + ESP32 idle current dominate.

## Common ground

ESP32 GND, relay GND, buck output GND, and the solenoid 12V return must all share a common GND. The optocoupler isolates the logic SIDE from the COIL side, but for the logic level itself to be valid you still need ESP32 GND ↔ relay GND ↔ buck GND tied together.
