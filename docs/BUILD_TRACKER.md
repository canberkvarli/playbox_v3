# PlayBox prototype build tracker

Soft-launch goal: one portable station, carried to a court daily, charged nightly. Bluetooth-only, phone talks straight to the ESP32.

Decisions locked: nightly battery pull-out, basketball 240mm, parts from Amazon TR.

---

## Flags and corrections (read first)

These came out of comparing your wiring/parts plan against the repo's firmware and wiring docs.

1. **Only 1 of 3 solenoids.** Three doors, one solenoid on the bench. Buy 2 more identical units. See cart.

2. **No reed switches in the plan.** The 3-gate production firmware expects a door-closed reed on GPIO 18/19/21 per gate. The unlock works without them, but the return/re-lock flow (IN_USE to RETURN_UNLOCKED to LOCKED) needs them to know the door shut. Buy 3 before soft-launch. See cart.

3. **GPIO 12 strapping pin — RESOLVED: gate 2 moves to GPIO 27.** GPIO 12 is a boot strapping pin (flash voltage select); an active-LOW relay idles its input HIGH, which can stop the ESP32 booting. Decision made: solenoid 2 → GPIO 27. WIRING.md already updated. One-line firmware change still pending: `RELAY_PINS = { 13, 12, 14 }` → `{ 13, 27, 14 }` in `PlayboxStation_3gate.ino` (line 97) before wiring gate 2.

   **Flyback diodes — ADDED (earlier "not needed" note was wrong).** The relay's opto-isolation and its internal coil diode only protect the relay coil side, not the solenoid. The solenoid's back-EMF arcs the relay contacts and can glitch the ESP32. Put a 1N4007 across each solenoid, banded end (cathode) to the +12V side. See cart + WIRING.md "Flyback diodes".

4. **No SLA charger.** You picked nightly charging but the 7Ah is sealed lead acid; it needs a proper 12V SLA float charger, not a generic DC adapter. See cart.

5. **Battery telemetry needs 2 resistors.** Production firmware reads battery level on GPIO 34 through a 39k/10k divider. Add the resistors, or set `BATTERY_ADC_WIRED 0` and skip battery_low/critical events.

6. **Docs drift — fixed.** WIRING.md updated: spring plunger pops the door (not gas strut), and gate 2 is on GPIO 27. (You're reusing the existing rocker switch for power, not buying a key switch.)

---

## Phase 1: Procure (Amazon TR)

See `docs/PARTS_CART.md` for the full cart with search terms.

- [ ] Order 2 more solenoids (match the SANEC angled-pin you have)
- [ ] Order 3 reed switches + magnets (MC-38)
- [ ] Order 5x 1N4007 flyback diodes (one per solenoid + spares)
- [ ] Order 12V SLA charger
- [ ] Order 6-pin waterproof connector pair
- [ ] Order inline blade fuse holder + confirm 5A fuses on hand
- [ ] Order key switch (2-position, 12V 5A+)
- [ ] Order 18AWG silicone wire (red + black) + thin signal wire
- [ ] Order ferrule kit + crimper
- [ ] Order heat shrink set
- [ ] Order WAGO 221 assortment
- [ ] Order Faston 6.3mm spades (confirm battery tab size first)
- [ ] Order ADC divider resistors (39k + 10k) or trimpot
- [ ] Buy 9V battery for the multimeter
- [ ] Confirm spring plungers are covered on the woodworker side

## Phase 2: Case + mechanical (woodworker — see docs/CASE_DESIGN.md)

Layout now matches the Equip tower: 3 ball compartments, bottom key-locked brain drawer, left-hinged doors, removable back panel.

- [ ] Cut carcass to CASE_DESIGN cut list (356 W × 365 D × ~1300 H, 18mm marine ply)
- [ ] Notch back-right corner of all 4 dividers 20×20 for the vertical cable chase
- [ ] Bottom brain drawer on runners: fits battery flat + project box; key cam lock on front face
- [ ] 3 doors: 5mm tinted polycarbonate, left-hinged, r15 rounded corners
- [ ] Per door: solenoid pocket on RIGHT wall (rout each pocket to its solenoid size), strike bracket on door inner face
- [ ] Per door: ball-spring plunger in frame (pop-open), magnet on door top-right + MC-38 reed opposite
- [ ] Removable back panel: 10mm rebate, 8-10 screws, foam gasket
- [ ] Round the 4 external vertical arrises r15-20, prime + paint navy/orange

## Phase 3: Wiring (off the breadboard, into the drawer)

- [ ] Battery + via fuse to key switch (Faston tabs, inline fuse holder)
- [ ] Key switch out splits: (a) to LM2596 in, (b) to +12V rail for relay COM
- [ ] Re-confirm buck output is a true 5.0V under load before connecting ESP32
- [ ] Buck 5V to ESP32 5V/VIN and relay VCC (WAGO split)
- [ ] Common ground bus: battery minus, ESP32 GND, relay GND, buck GND, solenoid returns
- [ ] ESP32 GPIO 13/12(or 27)/14 to relay IN1/IN2/IN3
- [ ] Relay COM to +12V, NO to each solenoid + (never NC)
- [ ] Solenoid returns to common ground
- [ ] 3 reeds to GPIO 18/19/21, other leg to GND (INPUT_PULLUP)
- [ ] Optional: 39k/10k divider on GPIO 34, read at rest only
- [ ] 6 solenoid wires run UP the back-right chase from brain drawer to each door
- [ ] Each door's solenoid pair terminates in a 2-pin connector at the brain (so drawer disconnects)
- [ ] Ferrule all stranded ends, heat shrink all joints, zip-tie runs
- [ ] Powered-off continuity + polarity check with multimeter

## Phase 4: Firmware bring-up

Note: firmware is already written. Use `firmware/PlayboxStation_3gate/`. This phase is flashing + validating, not writing from scratch. Full steps in `docs/HARDWARE.md` "Flashing + validation checklist."

- [ ] If moving gate 2 off GPIO 12, update the pin `#define` in the 3-gate sketch
- [ ] Generate per-station secret (`openssl rand -hex 32`), set `STATION_SECRET_HEX`, mirror on server
- [ ] Flash, watch Serial @115200 for `[SELFTEST] signing core OK` and `boot` event
- [ ] Confirm it advertises and no relay clicks on power-up (boot-HIGH safety)
- [ ] `set_time`, then `unlock` each gate: relay pulses, door pops, `gate_opened` notified
- [ ] Close each door onto its reed: UNLOCKED to IN_USE
- [ ] `return_unlock` then close: RETURN_UNLOCKED to LOCKED, `gate_closed` notified
- [ ] Calibrate `BATTERY_DIVIDER` with the DMM if ADC is wired

## Phase 5: App + integration

- [ ] Put the firmware's BLE service UUID into `lib/hardware/ble.ts` (`PLAYBOX_BLE_SERVICE_UUID`)
- [ ] Match advertising name format in `nameFromStationId`
- [ ] Toggle `useDevStore.bleHardware = true`, walk one full OYNA unlock on real hardware
- [ ] Retune `IN_RANGE_RSSI` (-85 default) at the gate after first field test

## Phase 6: Final assembly + field test

- [ ] Mount everything in the drawer, slide home, confirm 6-pin mates cleanly
- [ ] Cam-lock the drawer, key-switch power on, full cold-boot test x10
- [ ] Charge cycle test: run a day's worth of unlocks, confirm nightly charge recovers it
- [ ] Carry test: confirm nothing rattles loose in transport
- [ ] First court session: sit with it, log every unlock and any failure copy that fires

---

## Open questions for you

- Gate 2 pin: move to GPIO 27, or pulldown on GPIO 12? (flag 3)
- Wiring the battery ADC divider, or skipping battery telemetry for the prototype? (flag 5)
