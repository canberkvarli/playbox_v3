# Gate 2 solenoid — dead, debug log (2026-08-12)

**Symptom:** gate 2's solenoid does not move at all. Not sticking, not weak — nothing.
Relay clicks, channel 2's LED blinks once on tap. Gates 1 and 3 fire normally.
This gate worked earlier today.

---

## Ruled out — with the evidence, not by assumption

| # | Suspect | How we know it's clear |
|---|---|---|
| 1 | **Firmware / code** | Only 4 things changed in everything flashed today: `REED_PINS` `{18,19,21}`→`{25,22,21}`, the `badc` INFO field, the `[RELAY] RELEASED` log line, and the watchdog `reconfigure()` fix. `RELAY_PINS = {13,27,14}` last changed in `96f6f10`, weeks ago. No gate-2 special case anywhere — every gate runs the same `g` loop. |
| 2 | **GPIO 27 / IN2 jumper** | Channel 2's LED lights when gate 2 is tapped ⇒ the pin drives, the jumper is on the right pin and seated at both ends. |
| 3 | **Relay coil, channel 2** | It clicks, and the LED confirms it energizes. |
| 4 | **The flyback diode** | Removed from the line entirely, wire joined straight through — still dead. |
| 5 | **Solenoid 2 itself + its own leads** | Connected to gate 3's circuit and it **fired**. Coil good, leads good. |
| 6 | **Buck converter / 5 V rail** | Relay coils energize; other two channels drive their solenoids fine. |
| 7 | **Reeds** | Different circuit — low-voltage input side, galvanically isolated from the switched side. And the relay click is already downstream of anything a reed could influence. Reeds are `{25,22,21}`, relays `{13,27,14}`, no overlap. |
| 8 | **Relay output screws** | Checked, tight. |
| 9 | **Battery / supply sag** | The other two solenoids pull in normally. |

## Still suspected — only two things left

Both sit in the same segment: **between channel 2's output screws and the Wago.**

**A. Relay channel 2 contacts.**
Coil energizes but the contacts don't conduct. These have been switching an
inductive load with no flyback diode for weeks — every de-energize arced across
them. Pitting and carbon build up until they stop passing current while the coil
still clicks happily.

**B. The wire run from channel 2's output to the Wago.** ← *the one Canberk suspects*
A conductor broken inside intact insulation. Those wires were pulled through the
panel holes today, and the Wagos were taken apart and reassembled. This fits
"worked this morning, dead this evening" better than gradual contact wear does.

---

## Tests, cheapest first

### 1. Flex test — no tools, no screws, 30 seconds
Fire gate 2 repeatedly while flexing the wire where it passes through the panel
hole and where it enters the Wago.
- **Solenoid twitches even once** ⇒ **B confirmed.** Broken conductor. Replace that run.
- Nothing ever ⇒ inconclusive, go to test 2.

### 2. Move gate 2 to the spare relay channel — no firmware change
The board has 4 channels and only 3 are used. Firmware drives GPIO 27; it does
not know or care which channel that lands on.

1. Move the dupont's **relay-board end** from `IN2` → `IN4`. Leave the ESP32 end on D27.
2. Move gate 2's two output wires from channel 2's screws → channel 4's screws.
3. Fire gate 2.

- **Fires** ⇒ **A confirmed.** Channel 2's contacts were dead. Permanently fixed on
  a healthy channel; channel 2 just sits unused. No code, no reflash.
- **Still dead** ⇒ **B confirmed.** Contacts were fine, the wire is broken. Replace
  that run.

Note: any repair or test that separates A from B has to touch the relay output
terminals once. The path physically terminates there — there is no way around it.
The flex test is the only thing that can confirm B without going near them.

---

## Not this gate's problem — don't conflate

**Gate 1** retracts and won't come back out. Different fault entirely: the coil
*does* de-energize (`[RELAY] gate 1 -> RELEASED (coil off)` proves it) and the
plunger binds. That one is mechanical — side load in the mounting, weak return
spring, or grit in the bore. Dry PTFE only, never oil.

## Once gate 2 is fixed
Flyback diodes go **across the coil**, not in the line — both legs on the
solenoid's own two terminals, band on the **+** side. In series they either drop
0.7 V or block entirely, and they give zero flyback protection either way.
