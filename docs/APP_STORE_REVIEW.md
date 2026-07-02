# App Store review — demo/reviewer login

Playbox is a hardware-companion app (BLE locker unlock). A reviewer has no
locker, so we ship a **reviewer account** that auto-enables **Demo Mode**: the
mock hardware driver runs even in the release build, so the full flow
(find station → OYNA → unlock → active session → return) works with no locker.
Without this, expect a **Guideline 2.1 (non-functional)** rejection.

## How it works (code)
- `constants/review.ts` → `REVIEW_PHONE` (the reviewer's login number).
- `hooks/useReviewerDemo` (mounted in `app/_layout.tsx`) sets `devStore.demoMode`
  = true when the logged-in `user.phone === REVIEW_PHONE`.
- `lib/hardware/index.ts` `getDriver()` returns the **mock** driver whenever
  `demoMode` is on — even in production.

## One-time setup (YOU — Supabase dashboard)
1. Pick the reviewer number and set it in `constants/review.ts` `REVIEW_PHONE`
   (E.164, e.g. `+905000000000`).
2. Supabase dashboard → **Authentication → Providers → Phone → Test OTP** (a.k.a.
   test phone numbers). Add a mapping: **REVIEW_PHONE → a fixed 6-digit code**
   (e.g. `424242`). No real SMS is sent for this number.
3. Keep `constants/review.ts` and the Supabase entry in sync.

> ⚠️ Cut the **release build AFTER** this is committed so Demo Mode is *embedded*
> in the reviewed binary — don't rely on OTA (Apple may test before the OTA
> applies). Build #29 (TestFlight/icon) predates this; the App Store submission
> build must be a fresh one.

## App Store Connect → "App Review Information" → Notes (paste)
```
This app pairs with a physical Bluetooth equipment locker. Since no locker is
available to the reviewer, a demo account runs the app in Demo Mode, which
simulates the locker so the entire flow can be tested end to end.

Sign in:
  Phone: <REVIEW_PHONE, e.g. +90 500 000 0000>
  Verification code: <fixed test code, e.g. 424242>

Then:
  1. On the map, tap any station and press "OYNA".
  2. Choose a sport and press the unlock button — the app simulates the
     Bluetooth handshake and opens a session (no hardware needed).
  3. The active-session timer runs; press "SEANSI BİTİR" to end and simulate
     returning the equipment.

Bluetooth is used only to unlock nearby lockers the user has rented; in Demo
Mode this is fully simulated. The app is in Turkish (target market: Türkiye).
```

## Demo account sign-in (for reviewers)
- Phone: **REVIEW_PHONE**
- Code: the fixed test OTP you set in Supabase

## Bluetooth usage strings (Info.plist)
- TR (current): `Playbox istasyonun kapısını açmak için Bluetooth kullanır.`
- EN (add for reviewers): `Playbox uses Bluetooth to unlock the equipment
  locker you rent when you're next to it.`
```
"ios": { "infoPlist": {
  "NSBluetoothAlwaysUsageDescription": "Playbox uses Bluetooth to unlock the equipment locker you rent when you're next to it. / Playbox istasyonun kapısını açmak için Bluetooth kullanır."
}}
```
