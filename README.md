# playbox

> türkiye için on-demand spor ekipmanı paylaşım uygulaması — şehrin her yerinde spor ekipmanı, anında, ücretsiz.

Playbox is a React Native (Expo SDK 52) mobile app for Turkey: an on-demand sports equipment sharing service powered by smart street-stations. Open the app, find the nearest station on a map, scan/unlock, borrow equipment, play, return.

**Status:** v0 scaffold complete. Onboarding flow + map home shipped. Hardware integration (BLE/QR) and Supabase data plane to follow.

## Stack

- **Expo SDK 52** + **Expo Router** (file-based, typed routes)
- **TypeScript** (strict)
- **NativeWind v4** (Tailwind for RN) — locked palette tokens
- **Reanimated 3** + **react-native-worklets** + **Gesture Handler**
- **i18next** + **expo-localization** — Turkish-locked default, English opt-in
- **Clerk** — phone OTP auth + session
- **Supabase** — Postgres + Realtime (client wired, schema TBD)
- **react-native-maps** + **expo-location** — map home
- **@gorhom/bottom-sheet** + **expo-blur** — sheet preview + city pill
- **Zustand** — local UI state (filters, selection)
- **expo-haptics** — every meaningful tap

## Setup

### Prereqs

- Node 20+
- pnpm or npm (project uses npm with `--legacy-peer-deps` due to Reanimated 3.16 peer churn)
- Xcode 15+ (for iOS Simulator)
- Android Studio (for Android Emulator)
- Expo Go app on a physical device for fastest iteration
- Accounts: [Clerk](https://clerk.com), [Supabase](https://supabase.com), [Google Cloud Console](https://console.cloud.google.com) (for Maps)

### Install

```bash
npm install --legacy-peer-deps
```

### Environment

Copy `.env.example` to `.env.local` and fill in:

```bash
cp .env.example .env.local
```

| Var | Required | Where to get it |
|---|---|---|
| `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` | for auth flows | Clerk Dashboard → API Keys → Publishable key |
| `EXPO_PUBLIC_SUPABASE_URL` | for data | Supabase Project → Settings → API |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | for data | Supabase Project → Settings → API |
| `EXPO_PUBLIC_GOOGLE_MAPS_IOS_KEY` | only for EAS Build (Expo Go uses Apple Maps) | Google Cloud Console → APIs → Maps SDK for iOS |
| `EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY` | for Android (always Google Maps) | Google Cloud Console → APIs → Maps SDK for Android |

> **Heads up — `EXPO_NO_DOTENV`:** if you have `EXPO_NO_DOTENV=1` exported in your shell (some IDEs set this), Expo will silently ignore `.env.local`. Run `unset EXPO_NO_DOTENV` or remove it from your shell profile.

### Clerk dashboard config

1. Enable **Phone** authentication (Settings → User & Authentication → Email, Phone, Username → Phone)
2. Enable **Username** field (same screen) — required for the handle capture step
3. (Later, when wiring data) Create a JWT template named `supabase` signed with your Supabase JWT secret

### Run

```bash
npx expo start
```

- iOS: press `i` (simulator) or scan QR with Expo Go on a physical device
- Android: press `a` (emulator) or scan with Expo Go
- Web: press `w` (limited support — mobile is the target)

If Metro caches stale bundles after dependency changes:

```bash
npx expo start -c
```

## Development

### Project layout

```
app/                     # Expo Router file-based routes
  _layout.tsx            # Root: ClerkProvider + GestureHandler + Theme
  index.tsx              # Auth-gated redirect
  (onboarding)/          # 7-screen onboarding stack
    welcome / intro-map / intro-social / permissions / phone / otp / handle
  (tabs)/                # Main app tabs
    map / play / profile
constants/theme.ts       # Locked palette: paper / ink / mauve / coral / butter
data/stations.seed.ts    # 30 placeholder stations (İst/Ank/İzm)
hooks/                   # useT, useLoadedFonts, useColorScheme
i18n/                    # i18next setup + tr.json + en.json
lib/                     # haptics, geo, supabase, clerk-token-cache
stores/                  # Zustand stores (mapStore)
```

### Conventions

- **Turkish-first.** All user-facing copy goes through `t()` from `useT()`. New strings are added to `i18n/locales/tr.json` first, then translated to `en.json`. `lng: 'tr'` is hardcoded — never key off device locale.
- **Palette discipline.** Use Tailwind classes (`bg-paper`, `text-ink`, `border-coral/30`). The 5 brand colors are locked in `tailwind.config.js` + `constants/theme.ts`. Never inline a hex value in app code.
- **Fonts.** Display: `font-display` (Unbounded Bold) / `font-display-x` (Unbounded ExtraBold). Body: `font-sans` (Inter Regular) / `font-medium` / `font-semibold`. Mono: `font-mono` (JetBrains Mono — for OTP cells, station IDs, countdowns).
- **Haptics on every meaningful tap.** Import `hx` from `lib/haptics`. Use `hx.tap()` for chip/marker, `hx.press()` for primary CTAs, `hx.yes()` on success, `hx.no()` on error.
- **No spinners.** Use skeleton loaders or stagger-fade entrances. Spinners are explicitly out of brand voice.
- **Optimistic mutations.** When data layer lands (Task 21+), every user action updates UI immediately; rollback on server error.
- **Accessibility.** All Pressables get `accessibilityRole="button"` + `accessibilityLabel`. Tap targets ≥ 44pt.

### Type checking

```bash
npx tsc --noEmit
```

### Adding dependencies

`npx expo install` is preferred (pins to SDK-compatible versions). When peer-deps fail (common with Reanimated 3.16):

```bash
npm install <pkg>@<sdk-pinned-version> --legacy-peer-deps
```

## Roadmap (post-scaffold)

1. **Supabase schema + RLS** — stations, sessions, friends tables; Clerk JWT template wired
2. **Unlock flow** — QR scan via expo-camera, BLE stub via react-native-ble-plx (requires dev build)
3. **Active session screen** — live timer, return instructions, photo verification
4. **Profile + streaks** — play history, weekly leaderboard, IG-shareable stat card
5. **Operator dashboard** — separate Next.js app (out of mobile repo)
6. **Payments** — iyzico/PayTR for deposits + premium tiers
7. **EAS Build pipeline** — dev + preview + production profiles, EAS Update for OTA

## License

Proprietary. © Playbox.
