# App Store review — Demo Mode & submission checklist

Playbox is a BLE hardware-companion app. A reviewer has no locker, so we ship
**Demo Mode**: the mock hardware driver runs even in release, so the full flow
(map → OYNA → unlock → active session → return) works with NO locker. Without
this, expect a **Guideline 2.1 (non-functional)** rejection.

## Reviewer entry — Demo Login (primary, simplest)
On the **welcome screen** there's a subtle **"Demo Login"** link → it reveals a
username field. Entering the configured demo username drops straight into the
app in Demo Mode — no phone, no OTP, no SMS, no Supabase account.

- Configure the accepted username(s) in `constants/review.ts` → `DEMO_USERNAMES`
  (default: `appstore`).
- A small **DEMO** badge shows top-center while in demo mode.

**Paste into App Store Connect → App Review Information → Notes:**
```
This app pairs with a physical Bluetooth equipment locker. Since no locker is
available to the reviewer, the app includes a Demo Mode that simulates the
locker so the entire flow can be tested with no hardware.

To enter Demo Mode:
  1. On the first (welcome) screen, tap "Demo Login".
  2. Enter username: appstore
  3. You're taken into the app (a "DEMO" badge appears at the top).

Then:
  • On the map, tap any station → "OYNA".
  • Pick a sport → press the unlock button. The app simulates the Bluetooth
    handshake and starts a session (no hardware, no card — the first session is
    free in demo).
  • The session timer runs; press "SEANSI BİTİR" to end and simulate returning
    the equipment.

Payments run through an external processor (iyzico), not in-app purchase.
The app is in Turkish (market: Türkiye).
```

## Alternate entry — reviewer phone + Supabase test OTP
If you prefer a "real" login: set `REVIEW_PHONE` in `constants/review.ts`, add a
matching **Test OTP** in Supabase → Auth → Phone (fixed code, no SMS). Logging in
with that number auto-enables Demo Mode (`hooks/useReviewerDemo`).

## ⚠️ Build the submission binary AFTER these commits
Demo Mode + the Info.plist strings must be **embedded** in the reviewed build —
don't rely on OTA (Apple may test before the OTA applies). Build #29 predates
this; cut a fresh build for the App Store submission.

---

# Software-side submission checklist

- [x] **Demo Mode** — full flow on mock hardware (this doc).
- [x] **BLE purpose string** — specific + bilingual (TR/EN) in `app.json`
      `NSBluetoothAlwaysUsageDescription` / `...PeripheralUsageDescription`.
- [x] **Location purpose string** — specific + bilingual in the `expo-location`
      plugin (`locationWhenInUse` + `locationAlwaysAndWhenInUse`).
- [x] **No IAP** — rental uses external payment (iyzico); no in-app-purchase code
      and no digital-unlock mechanic.
- [ ] **Privacy Policy URL** (Turkish, public web URL) — needed in ASC. The app
      has in-app `app/legal/privacy.tsx`; you still need a hosted URL.
- [ ] **Support URL** (Turkish).
- [ ] **App Privacy questionnaire** — declare precise location + payment/processor
      data honestly.
- [ ] **Real-device demo video** — Apple wants a video of the physical locker +
      app on a real iPhone unlocking; link it in review notes (belt-and-suspenders
      alongside Demo Mode).
- [ ] **ASC settings** — primary language Turkish; category **Sports** +
      secondary **Utilities**.

## Bluetooth / location strings (already set in app.json)
- BLE: `Playbox, kiraladığınız spor ekipmanı dolabının kilidini yalnızca dolabın
  yanındayken Bluetooth ile açar. / Playbox uses Bluetooth to unlock the
  sports-equipment locker you rent, only when you are next to it.`
- Location: `Playbox, yakınınızdaki ekipman dolaplarını haritada göstermek ve
  kiraladığınız dolaba yaklaştığınızı doğrulamak için konumunuzu kullanır. / …`
