# PlayBox case design (woodworker spec)

Goal: match the Equip Sport locker tower (the Decathlon reference). Tall narrow column, 3 stacked compartments with tinted "glass" doors hinged on the **left**, a short **key-locked brain drawer at the bottom** (where Decathlon prints its logo band), rounded vertical corners, and a **fully removable back panel** for cable service.

Reference: the two render images Canberk provided + https://equip.sport. Equip does NOT publish exact dimensions (checked their site and press — only described as "compact"), so the numbers below are sized around a real basketball and the actual electronics/battery, kept in Equip's proportions (~3.5:1 tall:wide). If you can physically measure a real Equip unit, trust the tape over these numbers and tell me the deltas.

Build in 18mm marine plywood. Navy body, orange accents. Metal note at the bottom.

---

## 1. What changed from the old plan

- **Brain + battery move to a bottom drawer**, not the tall back pull-out. The bottom ~200mm band is a key-locked drawer (cam lock). Open it with a key, slide the battery out to charge, slide back. This is the Decathlon-logo band on the reference.
- **The entire back panel is removable** (screwed, gasketed) so you can open it up and trace/fix cabling without touching the doors or the brain drawer.
- **Solenoid runs now go UP** from the bottom brain to each door (top door is ~1m of wire away — this is why the wire order is 3m, not 1m).
- Doors are **left-hinged**, latch on the **right** edge.

---

## 2. Overall dimensions

| | mm | Notes |
|---|---|---|
| External width | 356 | matches Equip proportion; = 320 internal + 2×18 walls |
| External depth | 365 | = 340 internal + 18 back panel + ~7 door/front |
| External height | ~1300 | 3 ball compartments + brain drawer + caps + header band |
| Corner radius (vertical arrises) | 15–20 | router roundover, see §8 |

Internal, per **ball compartment** (×3): **320 W × 320 H × 340 D**. Sized for a size-7 basketball (~240mm) with finger clearance to grab and reseat it. A size-5 football/volleyball also fits with room.

Internal, **brain drawer** (bottom): **320 W × ~190 H × 340 D**. Holds the 12V 7Ah battery lying flat (~151×98×95mm) plus the project box (ESP32 + relay + buck), WAGOs and fuse holder, with routing room.

---

## 3. Vertical stack (bottom to top)

```
 ┌─────────────────┐  top cap (18) + "Equip" header band (~60 tall, optional)
 │   ball comp 1   │  320 H   ← top door (Football)
 ├─────────────────┤  divider (18)
 │   ball comp 2   │  320 H   ← middle door (Basketball)
 ├─────────────────┤  divider (18)
 │   ball comp 3   │  320 H   ← bottom door (Volleyball)
 ├─────────────────┤  divider (18)
 │  BRAIN DRAWER   │  190 H   ← key-locked, battery + electronics
 └─────────────────┘  base (18)
```

Running height of panels + cavities ≈ 1240mm, + ~60mm header band ≈ **1300mm**. Adjust the header band to taste; everything below it is functional and should not shrink.

---

## 4. Cut list (18mm marine ply)

| Part | Qty | Size (mm) | Notes |
|---|---|---|---|
| Side wall (L/R) | 2 | 1300 × 365 | full height; round the front vertical edge (§8) |
| Top cap | 1 | 356 × 365 | |
| Base | 1 | 356 × 365 | sits on feet/levellers |
| Horizontal divider | 4 | 320 × 340 | 3 between ball comps + 1 above brain. Notch back-right corner 20×20 for cable chase (§7) |
| Back panel (removable) | 1 | 356 × ~1300 | **not glued** — screwed into a rebate, gasketed (§6) |
| Door, acrylic/PC | 3 | ~340 × 335 × 5 | tinted polycarbonate, not plywood. Round all 4 corners r15 |
| Brain drawer box (front, sides, bottom, back) | 1 set | front ~356×190, sides ~320×340 | small drawer on slides; front face carries the cam lock |
| Header band (optional) | 1 | 356 × 60 | "Equip"/"PlayBox" branding strip |

"Glass" doors = **5mm tinted polycarbonate** (acrylic also OK, polycarbonate is tougher outdoors). Frameless, like the reference. Polycarbonate won't shatter and takes a roundover.

---

## 5. Doors — hinges, latch, pop-open (per door ×3)

Hinge **left**, latch **right** (door opens to the left, exactly like the reference).

**Hinges (left edge):**
- 2 small hinges per door, top and bottom of the left edge.
- For a frameless acrylic look, use clamp/glass-style hinges or small piano-hinge segments screwed to the door face and the carcass left wall.
- Drill: pilot holes in the carcass left wall at ~40mm from top and bottom of each opening, matching holes in the door.

**Solenoid latch (right edge):** see §6 drill schedule. The solenoid body mounts to the carcass on the **right** side of each opening; its plunger throws horizontally into a **strike bracket** on the inner face of the door near the right edge. Energise → plunger retracts → door is free.

**Pop-open (spring plunger):** one ball-spring plunger per door, mounted in the carcass pressing the door's inner face near the latch (right) side. When the solenoid releases, the plunger shoves the door out ~15–20mm so the user can grab it. These are case hardware (woodworker side), not on the electronics order.

**Reed (door-closed sensor):** magnet on the door inner face, reed on the adjacent carcass, aligned to meet when shut (§6).

---

## 6. Drill & hardware schedule (the part you asked for)

Coordinates are per **ball compartment opening**, measured from the opening's own corners. Repeat for all 3.

**A. Hinges (left edge)** — 2 per door
- Carcass left wall: pilot holes 40mm down from opening top, and 40mm up from opening bottom.
- Match on the door's left edge.

**B. Solenoid + strike (right edge)** — 1 solenoid per door
- Mount the solenoid to the **right interior wall** (or to the divider's right end), plunger pointing **left**, centred vertically on the opening (~160mm down from opening top).
- Rout a **pocket** for the solenoid body so it sits flush and the plunger clears the door. **You have two solenoid sizes — rout each pocket to its own solenoid.** The bigger one just needs a deeper/wider pocket; both throw the same plunger, so behaviour is identical.
- On the door inner face, screw a small **L-shaped steel strike bracket** ~20mm in from the right edge, aligned to the plunger. Plunger drops behind it = locked. Retracts = free.
- Drill: 2 small screw holes in the door for the strike bracket; pocket + 2 mount screws in the carcass for the solenoid.

**C. Spring plunger (pop-open)** — 1 per door
- Carcass, right side, ~80mm above the solenoid. Drill a hole sized to the plunger barrel, press it in so the nose presses the door.

**D. Reed + magnet (door-closed)** — 1 per door
- Magnet: recess into the door inner face at the **top-right** corner (near the latch, where the door seats tightest).
- Reed (MC-38): mount on the carcass directly opposite, so magnet and reed sit within ~5–10mm when the door is shut.
- Drill: shallow recess for the magnet in the door; 2 screw holes for the MC-38 on the carcass. Run the reed's 2 wires into the cable chase (§7).

**E. Brain drawer cam lock (bottom front)**
- One key cam lock centred in the brain drawer face. Drill the cam-lock barrel hole (typ. 19–20mm) in the drawer front. Cam catches a small keeper screwed to the carcass.

**F. Back panel fixing** — see §6 of the removable-back note below.

---

## 7. Cable routing (brain → doors)

- Cut a **20×20mm notch in the back-right corner of every horizontal divider** so a vertical wiring chase runs the full height at the back-right interior corner.
- All 6 solenoid wires (2 per door) and 3 reed pairs run **down this chase into the brain drawer cavity**.
- At the brain, terminate each door's pair in the **2-pin waterproof connectors** so the brain drawer can be disconnected and pulled fully. (One 2-pin connector per solenoid; reeds can land straight on a WAGO since they rarely need disconnecting.)
- Zip-tie the runs to the chase so nothing fouls a ball.

---

## 8. Rounded corners

The reference's big soft radius is injection-moulded plastic. In plywood you approximate it:
- Run a **15–20mm roundover bit** down the 4 external **vertical** arrises (the front-left, front-right, back-left, back-right edges).
- Optionally ease the top edges with the same bit.
- Round the 4 corners of each polycarbonate door with a file/router to r15 so they read like the frameless reference doors.
- Fill, prime, sand, paint navy. The roundover + paint gets you most of the way to the moulded look.

---

## 9. Removable back panel (service access)

- The back is a **single 18mm panel**, NOT glued.
- Rout a **10mm × 10mm rebate** around the back opening of the carcass; the panel sits in the rebate.
- Fix with **8–10 screws** into the rebate lip (3 per long side, 2 top/bottom). Use threaded inserts if you'll open it often.
- Lay a thin **foam/EPDM gasket** in the rebate so it's weather-resistant for the soft launch.
- Unscrew = full access to the back-right cable chase, every solenoid, every reed, and the back of the brain. This is your "open it up and trace the cables" panel.

(Two separate access points by design: the **bottom key drawer** = frequent, for the battery; the **back panel** = occasional, for cabling.)

---

## 10. Brain drawer (bottom)

- Small drawer on **side runners**, opening from the **front** (the Decathlon-band position).
- Face secured by the **key cam lock** (§6E). Casual users can't open it; you can, with the key.
- Inside: battery flat at the front (slides out first when you open the drawer), project box behind it, fuse holder + key/rocker switch reachable.
- Battery disconnects via its faston/clip leads so you can lift it straight out to charge and drop a charged one back.
- Leave a finger gap or a recessed pull on the drawer face.

---

## 11. Wood vs metal

- **Wood (plywood) is right for the prototype:** cheap, fast, easy to rout pockets/chases, easy to modify when something doesn't fit. Marine ply + primer + exterior paint survives a soft launch fine.
- **Metal** (folded aluminium/steel) gets you the true moulded-corner look, better weather/vandal resistance, and a thinner wall — but it's much pricier to prototype, needs fabrication tooling, and is a pain to modify mid-build. Not worth it until the wood prototype proves the layout. If the wood version works and you go to pilot units, that's the moment to re-quote metal. The internal layout here transfers to metal unchanged.

---

## 12. Open items to confirm before cutting

- Real Equip footprint if you can measure one (these numbers are proportion-matched, not measured).
- Final ball: sized for a 240mm basketball. If you standardise on a smaller ball, compartments can shrink and the whole tower gets shorter.
- Door hardware style: frameless glass-hinges vs piano-hinge segments — pick based on what the woodworker can source.
