# PlayBox — how the system lives in the case

This is the "point and explain" doc, not a cut list. Use it to walk the woodworker through where everything sits and how the cables run, so he leaves the right room and access in the wood. The exact sizes live in `CASE_DESIGN.md`.

The whole thing is one tall column: 3 ball compartments on top, the electronics "brain" in a short locked drawer at the bottom. Everything electrical lives in the brain. Each door just needs a lock, a pop-open, and a closed-sensor — and three thin wire runs come down to the brain to feed them.

---

## The zones (top to bottom)

```
        ┌──────────────────────────┐
        │      header band         │   branding only, nothing inside
        ├──────────────────────────┤
        │   ◄ DOOR 1 (top)         │   ball compartment
        │   lock · pop · sensor    │      │
        ├──────────────────────────┤      │  3 thin wire runs
        │   ◄ DOOR 2 (middle)      │      │  come DOWN the
        │   lock · pop · sensor    │      │  back-right corner
        ├──────────────────────────┤      │
        │   ◄ DOOR 3 (bottom)      │      │
        │   lock · pop · sensor    │      ▼
        ├══════════════════════════┤  ← key-locked
        │   BRAIN DRAWER           │   battery + electronics live here
        │   (battery + brain box)  │   all wires terminate here
        └──────────────────────────┘
                                        ← whole BACK panel unscrews
```

Doors hinge on the **left** and open to the left. The lock and sensor are on the **right** edge of each door.

---

## The one cable path

There is a single vertical "spine" for wires: the **back-right inside corner**, top to bottom. Tell the woodworker: **notch a small corner out of every shelf at the back-right** so a channel runs the full height. Every wire in the whole unit travels in that one channel.

From each door, two solenoid wires (the lock) and two sensor wires drop into that channel and run **down into the brain drawer**. The top door's wires are the longest run — most of a meter — which is why the wire is 3m, not 1m.

So when you explain it: *"all the cables come down this back-right corner and meet in the brain at the bottom."*

---

## What each door needs (the woodworker provides the room, you provide the parts)

Three things sit at each door, all on the **right** edge:

1. **The lock (solenoid).** A small electromagnet bolted to the frame on the right side of the opening. A metal pin shoots out and catches the door shut. Power it for a moment → pin pulls back → door is free. He needs to **rout a pocket** in the frame for it to sit flush. You have two solenoids of slightly different size — each just gets a pocket sized to it; they behave the same.
2. **The pop-open (spring plunger).** A spring-loaded nub pressed into the frame that shoves the door out ~2cm once the lock lets go, so a person can grab it. Pure hardware, no wires.
3. **The closed-sensor (reed + magnet).** A tiny magnet in the door's top-right corner and a matching sensor on the frame. When the door is shut they line up and the brain knows the door is closed. Two thin wires from the sensor go into the channel.

Same three things, three times, one per door.

---

## The brain drawer (bottom)

Everything electrical lives here, in the short locked drawer at the very bottom (the spot where Decathlon prints its logo on the reference unit).

- **Battery** sits flat at the front so it slides straight out.
- Behind it: the **electronics box** (the controller, relay, power converter), the **fuse**, and the **power switch**.
- The drawer face has a **key cam-lock**. Casual users can't open it; you can, with the key.
- The three door wire-runs come down the channel and **plug into connectors** at the brain, so the whole drawer can be unplugged and pulled out.

Daily routine: unlock the drawer with the key, lift the battery out, charge it overnight, drop it back in. That's the only thing that gets touched day to day.

---

## Two ways in (by design)

- **Bottom key drawer** — frequent. Just for the battery (and a quick look at the brain). Key-locked.
- **Whole back panel** — occasional. Unscrews completely so you can reach into the wire channel and fix or re-route any cable along the full height without disturbing the doors. This is your "open it up and see how the cables are going" panel, exactly what you asked for.

---

## One-line version for the woodworker

> "Three ball lockers up top, each door hinged on the left with a lock and a sensor on the right. All the wires run down the back-right corner into a key-locked battery drawer at the bottom. And the entire back comes off with screws so I can get at the wiring."
