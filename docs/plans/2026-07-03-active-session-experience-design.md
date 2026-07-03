# Active-Session Experience — Design

**Date:** 2026-07-03
**Goal:** Make "you have a live session" unmissable across every surface — inside the app, on the lock screen / Dynamic Island, and on the home screen.

## Surfaces

### 1. In-app (OTA, SDK 54 — already shipping)
- **Bottom banner** (`components/ActiveSessionBanner.tsx`): static card just above the tab bar — dot · SPORT · STATION · countdown · volt "OYNA ›" pill. Dark asphalt on-time, pulsing coral on overrun. Tappable → `/(tabs)/play`. ✅ done.
- **Glowing play tab** (`app/(tabs)/_layout.tsx` `PlayTabIcon`): pulsing volt halo behind the play icon while a session is active. ✅ done.
- **Next (optional):** live countdown chip on the map header; session-tinted accents.

### 2. Live Activity + Dynamic Island (native, SDK 57 + expo-widgets)
- **Lock screen / Notification Center card:** SPORT · STATION, a live countdown to planned end, overrun state (coral, "GEÇ +mm:ss"), and an "iade et" hint. Tapping opens the app to `/(tabs)/play`.
- **Dynamic Island:**
  - *Compact:* volt dot + countdown.
  - *Expanded:* station name, sport, countdown ring, "OYNA'ya git" affordance.
  - *Minimal:* countdown only.
- **Lifecycle:**
  - **Start** on successful unlock (`app/session-prep/[stationId]/[sport].tsx` onOyna, after `startSession`).
  - **Update** on overrun crossing and on return-initiated; otherwise rely on the OS timer for the countdown (no per-second JS updates).
  - **End** on `endSession` (`stores/sessionStore.ts`).

### 3. Home Screen widget (native, SDK 57 + expo-widgets)
- **Active:** SPORT · STATION + countdown, volt accent.
- **Idle:** "yakınında bir kort bul" CTA → deep link to the map.
- Timeline refreshes on session start/end (widget reload from JS).

## Architecture (expo-widgets)
- `expo-widgets` (first-party) builds both the widget and the Live Activity from `expo/ui` (SwiftUI) components — no hand-written Swift.
- **Data model:**
  - `ActivityAttributes` (static): `{ stationName: string, sport: string, gate: number }`
  - `ContentState` (dynamic): `{ startedAt: number, plannedEndAt: number, overrun: boolean }`
  - Countdown rendered from `plannedEndAt` using SwiftUI's timer text so the OS ticks it — no JS wakeups.
- **Control flow:** zustand `sessionStore` is the single source of truth. Thin `lib/liveActivity.ts` wrapper calls `expo-widgets` start/update/end + widget reload. Called from the same places that mutate the session (onOyna success, endSession, overrun tick).
- **Theme:** Live Activity / widget use the fixed dark-asphalt + volt identity (they don't follow the in-app light/dark toggle), matching the banner.

## Sequencing
1. **SDK 54 → 57 upgrade** in a worktree; get `tsc` green; keep `main` on 54 for OTA hotfixes to build #30. *(in progress)*
2. Merge upgrade to `main`; cut a fresh SDK-57 build (#31) — becomes the new review target (SDK 57 can't OTA onto #30).
3. Add `expo-widgets`; implement the Live Activity (lock screen + Dynamic Island).
4. Implement the home-screen widget.
5. Wire `lib/liveActivity.ts` into session start/update/end.
6. Device test (Live Activities need a real build + iOS 16.2+), iterate.

## Constraints / notes
- Live Activities: iOS 16.2+, real device (not Expo Go, not simulator for full behavior).
- Assets in Live Activities must be < 4KB.
- Requires `NSSupportsLiveActivities` (expo-widgets plugin sets this) and, for the widget↔app data share, an App Group (plugin-managed).
- Push-updating the Live Activity from the server is a later enhancement; v1 updates locally from the app while foregrounded + relies on the OS timer for the countdown.
