# Playbox 3-gate hardware wiring

## Pin map (ESP32 NodeMCU-32S)

| Function | GPIO | Notes |
|---|---|---|
| Heartbeat LED | 2 | Onboard blue LED |
| Solenoid 1 (Football) | 13 | Via MOSFET gate |
| Solenoid 2 (Basketball) | 12 | Via MOSFET gate |
| Solenoid 3 (Volleyball) | 14 | Via MOSFET gate |
| Reed switch 1 | 18 | INPUT_PULLUP, magnet near = LOW |
| Reed switch 2 | 19 | INPUT_PULLUP, magnet near = LOW |
| Reed switch 3 | 21 | INPUT_PULLUP, magnet near = LOW |

## Solenoid driver circuit (per gate, x3)

```
ESP32 GPIO ─── 220Ω ─── [Gate]  IRLZ44N (logic-level N-channel MOSFET)
                                  │
                          ┌───────┴───────┐
                          │               │
                       [Drain]        [Source] ── GND
                          │
              ┌───────────┴───────────┐
              │  12V solenoid coil    │
              │  + flyback diode      │  ←─ 1N4007 anode at drain, cathode at +12V
              │  (1N4007 reversed)    │
              └───────────┬───────────┘
                          │
                       +12V ────────  battery / buck output
```

**Critical**: the flyback diode is non-negotiable. Without it, the MOSFET dies the first time the solenoid de-energises (back-EMF spike can hit several hundred volts).

## Reed switch wiring (per gate, x3)

```
ESP32 GPIO (e.g. 18) ──────── one leg of reed switch
                                          │
GND ────────────────────────────────── other leg
```

INPUT_PULLUP in firmware. Magnet near → switch closes → GPIO reads LOW = "door closed". No magnet → switch open → pullup pulls HIGH = "door open".

## Power budget

- ESP32: 5V from buck (USB-style), ~150 mA peak
- Solenoids: 12V from battery / second buck output, ~1 A inrush per solenoid for 300 ms during pulse, 0 the rest of the time
- Reed switches: passive, no power draw

Sizing: a 12V 5 Ah battery handles ~30 unlock cycles per hour for days. The brief solenoid pulses are easy on the battery.

## Common ground

The ESP32, the solenoid 12V rail, and any MOSFET source pins must all share a common GND. Without a shared ground, MOSFET switching is unreliable.

## Bootstrap / boot-mode safety

GPIO 13, 12, 14 are all safe at boot — they don't double as boot-mode straps. GPIO 0 and 2 are strap pins and must not be used for solenoids (would prevent boot if energised at reset).
