# Active session UI redesign

**Date:** 2026-05-28
**Status:** design accepted, ready for plans

## Problem

The current active-session experience is over-built for what it actually is — a glance. The `/play` tab is a 1555-line scroll with a map, a drawer list, banners, and an oversized info card. The `ActiveSessionBanner` is a scrolling marquee that floats over every other screen. Together they assume the user is looking at the phone during the session. They're not — the phone is in their pocket, on a bench, or in a bag. They glance once or twice, usually to start the return.

## Principle

**Pocket-and-glance.** The phone is stowed. The user pulls it out for a few seconds, twice. The truest glance surface is the lock screen, not an in-app screen. The app effectively disappears during the session.

## Three surfaces, one source of truth

```
Lock screen (PRIMARY)     iOS Live Activity + Dynamic Island
                          Android persistent rich notification
        │
        ├─ same phase machine, same colors, same data
        │
In-app pill (SECONDARY)   floats above tab bar on every screen
                          except /play, /session-prep, /session-review,
                          /scan, /card-add
        │
        ├─ tap to expand
        │
/play tab (DEEP)          single-screen control room, no scroll,
                          one hero CTA, phase-driven layout
```

`useSessionStore` stays as-is. No model changes. All three surfaces subscribe to it.

## Phase → visual state machine

Derived from existing fields on `ActiveSession`:

| Phase | Trigger | Color | Primary text | CTA |
|---|---|---|---|---|
| `playing` | `remaining > 5min` | `ink` | `MM:SS KALDI` | none (lock screen) / "geri ver" (in-app) |
| `last_five` | `remaining ≤ 5min && > 0` | `butter` | `MM:SS KALDI` | "geri ver" |
| `overrun` | `remaining < 0` | `coral` (pulsing) | `-MM:SS GEÇ` | "geri ver" |
| `returning` | `returnPhase === 'opening'` | `ink` | `kapı açılıyor…` | none, locked |
| `awaiting_close` | `returnPhase === 'awaiting_close'` | `butter` | `kapıyı kapat` | "kapattım" |
| `done` | `returnConfirmed` | `ink` | `seans tamamlandı` | → review |
| `firmware_warn` | any of `unlockTimedOut`, `returnTimedOut`, `stationRebooted` | `coral` | warning text | "aç" → /play |

Single function `phaseFor(active): Phase` lives in `lib/session/phase.ts`. All three surfaces call it.

## Surface 1 — Lock screen

**iOS Live Activity + Dynamic Island.** New Expo Module `modules/SessionLiveActivity` with three methods:

```ts
start({ sport, station, gate, durationMs })
update({ phase, remainingMs, flags })
end()
```

Driven by a single subscriber in `app/_layout.tsx` watching `sessionStore`. Tick gated by phase (1s during `last_five` / `overrun`, 5s otherwise) to keep the budget. Deep link `playbox://session/return` → `/play`.

Compact, expanded, and minimal Dynamic Island presentations. Coral pulse for overrun. "kapıyı kapat" CTA renders on the lock screen during `awaiting_close` — taps deep-link into the in-app confirm.

**Android.** Foreground service with a `MediaStyle`-shaped persistent notification on a `LOW`-importance channel `playbox.session.active`. Sticky / ongoing. Two action buttons: `geri ver`, `aç`. Same phase coloring via the notification's color hint.

## Surface 2 — In-app pill (replaces marquee)

Rename `components/ActiveSessionBanner.tsx` → `components/ActiveSessionPill.tsx`. Same mount point in `app/_layout.tsx`, same route exclusions.

- 56pt tall, full width minus 12pt gutters, `palette.ink` default, `borderRadius: 18`.
- Static row: `● sport · station` / `MM:SS` / `▴`.
- Color shifts with `phaseFor()`. Coral pulse on overrun.
- Tap anywhere → `/play`.
- Firmware warn flags collapse to a single trailing `●` dot; detail on `/play`.
- The scrolling marquee is gone. The reanimated marquee animation, the duplicated text labels, and the `TICKER_PPS` constant all delete.

## Surface 3 — `/play` redesigned

Single-screen, no-scroll, phase-driven canvas. Drops from ~1555 to ~400 lines.

**Layout (`playing` phase):**

```
[firmware banner slot, 56pt, conditional]
                ⋮ overflow

         🏀  BASKETBOL
       ━━━━━━━━━━━━━━━━━
              64%

           12:43
           KALDI

       DEV-001 · KAPI 2

   [ ekipmanı geri ver ]
```

**Layout (`awaiting_close` phase):** hero stays, progress bar morphs into an animated diagonal-hatch "door open" visual, secondary text becomes `kapıyı kapatınca seans biter`, CTA becomes "kapattım" (manual fallback for benches without reed switches).

**What dies inside `/play`:**
- Map rendering
- Bottom drawer list
- All in-screen banners (move to a 56pt overlay slot above the hero)
- The `LiveTimer` component (timer is now the hero, inlined)
- Bench/dev toggle, "nasıl oynanır", help → all move into `⋮` overflow menu

**What stays:**
- `useSessionStore` subscription
- `useStationInRange(active?.stationId)` proximity watcher
- `returnPhase` state machine and the `return_unlock` BLE write
- Firmware-event handling
- Bench-mode toggle (now behind `⋮`)

## Implementation tracks

**Track A — in-app refactor.** Pill rename + new `/play` canvas. ~1 week. No native code. Ship independent of Track B; the Live Activity is additive.

1. Add `lib/session/phase.ts` with `phaseFor(active): Phase` and `colorFor(phase)`.
2. Rename `ActiveSessionBanner` → `ActiveSessionPill`, rewrite as static row driven by `phaseFor`.
3. Rewrite `app/(tabs)/play.tsx` as a single-screen canvas with phase-driven CTA / secondary slot. Move dev/help into `⋮`.
4. Delete the in-screen map and drawer code paths from `/play`.
5. Smoke-test on bench: fake session, real session, overrun, return flow, firmware events.

**Track B — Live Activity / Android persistent notification.** ~2-3 weeks. Native module work, store-submission considerations.

1. Scaffold `modules/SessionLiveActivity` (Expo Modules API).
2. iOS: SwiftUI Live Activity widget bundle, three presentations (compact, expanded, minimal). Coral pulse via `withAnimation`. Deep-link entitlement.
3. Android: foreground service + `NotificationCompat.MediaStyle` notification, sticky, `LOW` importance.
4. Single subscriber in `app/_layout.tsx` mirroring `sessionStore` → `update()` with phase-gated tick.
5. End-to-end bench test: start → playing → last_five → overrun → returning → awaiting_close → done, on both platforms.

## Out of scope

- Apple Watch app / complication (future)
- Haptic milestone patterns (future, easy add to Track A)
- Audio cues ("10 dakika kaldı") (future)
- Friend / co-play scoreboard (different design, different user mode)

## Open questions

- Live Activity push updates (vs local-only) — needed only if we want server-driven phase changes (e.g., remote overrun warnings). Defer.
- Whether the `awaiting_close` "kapattım" CTA should also live on the lock screen as an interactive button or just as a deep link. Start with deep link, A/B later.
