# PlayBox prototype electronics cart

Decisions locked: pull battery out nightly to charge, basketball size (240mm, compartments stay 320x340x340), source on Amazon TR.

Status key: [ ] to buy, [x] have, [!] critical missing item not on your original list.

Prices are mid-2026 ballpark in TL for one good listing. Links are Amazon TR searches, not fixed SKUs. Pick the best rated one with the matching spec.

## Critical additions (these were NOT on your buy list)

| ? | Item | Spec | Qty | Why | Search |
|---|------|------|-----|-----|--------|
| [!] | Solenoid lock | SANEC 12V angled pin, same as the one you have | 2 more (3 total) | You have 3 doors but only 1 solenoid. One per compartment. | "12V solenoid kilit eğik pim" |
| [!] | Reed switch + magnet | wired magnetic door contact, closes when magnet near | 3 | Firmware reads door-closed on GPIO 18/19/21 to drive the return flow (IN_USE to LOCKED). Without them the re-lock state never completes. | "manyetik reed switch kapı sensörü kablolu" |
| [!] | SLA battery charger | 12V lead-acid smart/float charger, 0.8 to 1A | 1 | You chose nightly charging. The 7Ah is sealed lead acid, needs a 13.8 to 14.4V SLA charger, not a generic adapter. | "12V akü şarj cihazı kurşun asit 1A" |
| [!] | Flyback diode | 1N4007 (or 1N5819 Schottky), 1A+ | 5 (3 + spares) | One across each solenoid coil, cathode (banded end) to the +12V side. The relay's opto-isolation does NOT protect against the solenoid's back-EMF; that spike arcs the relay contacts and can glitch/reset the ESP32. Cheap and important, don't skip. | "1N4007 diyot" |
| [ ] | ADC divider resistors | 39k and 10k, 1/4W (or one 10-turn 50k trimpot) | 1 pair | Optional but recommended. Production firmware reads battery % on GPIO 34 via a 39k/10k divider and fires battery_low / battery_critical. Skip only if you set BATTERY_ADC_WIRED 0. | "1/4w direnç seti" |
| [ ] | 9V battery | alkaline | 1 | Your multimeter needs one for assembly/testing. | "9V pil" |

## Your buy list, finalized

| ? | Item | Spec / note | Qty | Search |
|---|------|-------------|-----|--------|
| [x] | Project box | SANEC ABS 113 x 197.4 x 63mm. Tight but fits ESP32 + relay + buck + WAGOs if laid out flat. Battery rides separately in the drawer, not in this box. | 1 | already chosen |
| [ ] | 6-pin waterproof connector pair | male+female, panel/inline, rated 5A+. Carries the 6 solenoid wires drawer-to-doors. | 1 pair | "6 pin su geçirmez konnektör erkek dişi" |
| [ ] | Inline blade fuse holder | wired ATO/ATC holder, 16AWG+ leads | 1 | "kablolu bıçak sigorta yuvası" |
| [x] | Blade fuses | 5A (you have these). Solenoids fire one at a time, ~1A inrush each. 5A is right. | - | have |
| [ ] | Key switch | 2-position ON/OFF, 12V, 5A+ | 1 | "anahtarlı switch 12V 2 konum" or "kontak anahtarı 2 konum" |
| [ ] | Silicone wire 18AWG | red + black, ~3m each, for 12V power + solenoid runs | 1 set | "18 AWG silikon kablo kırmızı siyah" |
| [ ] | Thin signal wire (optional) | 22-24AWG multicolor, for the 3 reed switches | 1 | "22 awg silikon kablo renkli" |
| [ ] | Ferrule kit + crimp tool | bootlace ferrules, self-adjusting hex crimper | 1 set | "kablo yüksük seti pense" |
| [ ] | Heat shrink set | assorted diameters | 1 | "makaron ısı ile daralan boru seti" |
| [ ] | WAGO 221 lever connectors | mix of 2-port and 3-port (ground bus + buck 5V split) | ~10-15 | "wago 221 klemens seti" |
| [ ] | Faston 6.3mm spade terminals | insulated female, F2 6.3mm for the battery tabs. Verify your 7Ah uses F2 (6.3mm), not F1 (4.8mm) before crimping. | 1 pack | "faston terminal 6.3mm dişi yalıtımlı" |
| [ ] | Zip ties | assorted | 1 pack | "kablo bağı seti" |
| [ ] | Double-sided foam tape | mount boards to drawer floor | 1 | "çift taraflı köpük bant" |
| [ ] | Velcro strap | battery hold-down in drawer | 1 | "cırt cırt kablo bandı" |

## Already on the bench (no buy)

12V 7Ah SLA battery, ESP32 NodeMCU-32S, LM2596 buck (set to 5.0V), TLS Robotik 4-channel active-low relay, 1 solenoid, fuse tap, breadboard + jumpers + alligator clips (bench only, retiring for the build), multimeter.

## Notes / sanity checks

- Flyback diodes: NEEDED, one per solenoid (corrected). Earlier note said skip these, that was wrong. The relay's opto-isolation and its internal coil diode only protect the relay's own coil side. The solenoid is an inductive load on the relay's mechanical contacts, and its back-EMF arcs those contacts and can glitch the ESP32. Put a 1N4007 across each solenoid, banded end (cathode) to the +12V side.
- Spring plungers for pop-open (3x): these are case hardware, on the woodworker side, not in this electronics cart. Make sure that's owned by someone.
- Magnets for the reeds: most wired door contacts ship with their magnet. If yours don't, add 3 small neodymium magnets.
- Project box is snug. If the lid won't close over the relay + buck stack, plan to mount boards directly to the drawer floor instead and use the box only for the most exposed parts.
