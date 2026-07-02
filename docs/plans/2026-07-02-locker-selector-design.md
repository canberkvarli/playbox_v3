# Locker Selector — station sport picker redesign

**Date:** 2026-07-02
**Replaces:** the vertical sport-row list in `components/StationGateSelector.tsx`
(GateCard rows with the `seç` label).

## Idea
Instead of a list of pill rows, the station screen shows an **abstract Playbox
locker**: a boxy frame with a grid of compartments. The station's sports each
sit behind a compartment door as a **volt line-art ball**. Tapping an available
door **opens it** (door slides/fades away, ball springs in with a bounce +
haptic) and selects that sport. Out-of-stock/empty compartments stay shut, and
**shake + buzz** when tapped. Then the existing **OYNA** button unlocks the
selected gate (real BLE for you; mock in Demo Mode).

## Look & tech
- **SVG** (`react-native-svg`, already installed) for the line-art balls; RN
  Views + **reanimated** for the locker frame, compartment doors, and animations
  (easier/robust than animating raw SVG).
- **Balls (volt line-art, monochrome):** basketball (reuse the app-icon mark),
  soccer (circle + pentagon seams), tennis (circle + curve), volleyball (circle
  + 3 curves). Volt when available, muted grey when disabled/empty.
- **Locker frame:** dark rounded body, volt hairline, subtle hinge/vent details
  so it reads as a physical locker. A tiny `PLAYBOX` etch for character.

## Layout
- 2-column grid. Compartment count = the station's sports, padded up to an even
  number (max 4) with **decorative empty doors** for the locker feel.
- Each compartment: door (closed by default) → ball + sport name behind it.

## States
- **Available (stock > 0):** volt ball, door openable, tap → open + select
  (volt ring), haptic. Only one selected at a time.
- **Out of stock (station has the sport, stock 0):** grey, door shut; tap →
  shake + error buzz (no select).
- **Empty (decorative filler door):** grey, shut, non-interactive.

## Wiring
- New `components/LockerSelector.tsx` (self-contained: takes `station`,
  `selected`, `onSelect`, mirrors GateCard's inputs).
- `StationGateSelector` renders `<LockerSelector>` in place of the GateCard list;
  selection state + the OYNA CTA logic are unchanged.

## Also (same pass)
- **Demo vs dev controls:** the raw bench tools (`KAPAT (sim)`, `FW DURUMU OKU`,
  the 1·2·3 gate matrix) show only for **you** (`__DEV__`), never for a reviewer
  (release + Demo Mode). Reviewers just use the normal OYNA → session → return.
- **DEMO badge** moved below the nav bar (done).

## Out of scope (YAGNI)
- No 3D door flip (simple slide/scale). No per-ball unique unlock animation
  beyond the shared open/pop. No config for grid size.
