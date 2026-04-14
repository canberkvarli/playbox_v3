# Playbox v3 Scaffold + Onboarding Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Scaffold a fresh Expo SDK 52 app in `playbox_v3/` with the locked design system, Turkish-first i18n, Clerk phone-OTP onboarding, and a map home screen that feels alive on first open.

**Architecture:** Expo Router (file-based, typed) with three route groups — `(onboarding)` for auth/intro, `(tabs)` for the main app (Map / Play / Profile), and a root `_layout.tsx` that gates access via Clerk auth state. NativeWind v4 for styling with Tailwind tokens mapped to the locked Playbox palette. i18n via i18next with Turkish as the source language, English as translation. Clerk owns identity; Supabase client is stubbed for v2 data wiring.

**Tech Stack:** Expo SDK 52, Expo Router, TypeScript, NativeWind v4, Tailwind, Reanimated 3, Gesture Handler, expo-haptics, expo-font (Unbounded, Inter, JetBrains Mono), i18next + react-i18next, expo-localization, @clerk/clerk-expo, expo-secure-store, @supabase/supabase-js, react-native-maps, expo-location, TanStack Query, Zustand.

**Locked design tokens:**
- `paper` `#f5f5f5`, `ink` `#572c57`, `mauve` `#9f5f91`, `coral` `#e26972`, `butter` `#f6ea98`
- Display: Unbounded 700/800 · Body: Inter 400/500/600 · Mono: JetBrains Mono

**Out of scope for this plan:** Supabase queries, BLE, QR unlock, payments, Sentry/PostHog (stub env only), leaderboards. These get their own plans.

---

## Phase 0 — Repo bootstrap

### Task 1: Initialize Expo project in `playbox_v3`

**Files:**
- Create: `playbox_v3/package.json`, `playbox_v3/app.json`, `playbox_v3/tsconfig.json`, `playbox_v3/app/_layout.tsx`, etc.

**Step 1: Scaffold with Expo Router template**

The `playbox_v3/` directory already contains `.git`. Scaffold into a temp dir, then move files in to preserve git history.

Run:
```bash
cd /Users/canberkvarli/Development
npx create-expo-app@latest playbox-tmp --template tabs@52
rsync -a --exclude=.git playbox-tmp/ playbox_v3/
rm -rf playbox-tmp
cd playbox_v3
```

Expected: `playbox_v3/app/` exists with `(tabs)/` and `_layout.tsx`; `package.json` pins Expo SDK 52.

**Step 2: Verify it boots**

Run: `cd /Users/canberkvarli/Development/playbox_v3 && npx expo start --no-dev --minify` then quit with `q`.
Expected: Metro bundles without error.

**Step 3: Rename app identity**

Edit `app.json`: set `expo.name` = `Playbox`, `expo.slug` = `playbox`, `expo.scheme` = `playbox`, `expo.ios.bundleIdentifier` = `com.playbox.app`, `expo.android.package` = `com.playbox.app`, `expo.newArchEnabled` = `true`.

**Step 4: Commit**

```bash
git add -A
git commit -m "chore: bootstrap Expo SDK 52 + Expo Router tabs template"
```

---

### Task 2: Strip template cruft, add baseline gitignore

**Step 1:** Delete template files we'll replace: `app/(tabs)/index.tsx`, `app/(tabs)/explore.tsx`, `components/HelloWave.tsx`, `components/ParallaxScrollView.tsx`, any `assets/images/partial-react-logo*`. Keep `app/_layout.tsx`, `app/(tabs)/_layout.tsx`, `hooks/`, `constants/Colors.ts` (we'll replace contents in Task 4).

**Step 2:** Ensure `.gitignore` includes: `.env`, `.env.local`, `ios/`, `android/`, `.expo/`, `dist/`, `*.log`, `web-build/`, `node_modules/`.

**Step 3: Commit**

```bash
git add -A && git commit -m "chore: strip Expo tabs template demo files"
```

---

## Phase 1 — Design system

### Task 3: Install NativeWind v4 + Tailwind

**Step 1:** Run `npx expo install nativewind tailwindcss@^3.4 react-native-reanimated@~3.16 react-native-safe-area-context`

**Step 2:** Run `npx tailwindcss init`

**Step 3:** Create `babel.config.js`:

```js
module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      ['babel-preset-expo', { jsxImportSource: 'nativewind' }],
      'nativewind/babel',
    ],
  };
};
```

**Step 4:** Create `metro.config.js`:

```js
const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

const config = getDefaultConfig(__dirname);
module.exports = withNativeWind(config, { input: './global.css' });
```

**Step 5:** Create `global.css`:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

**Step 6:** Import in `app/_layout.tsx` top: `import '../global.css';`

**Step 7: Commit**

```bash
git add -A && git commit -m "feat(styling): install NativeWind v4 + Tailwind"
```

---

### Task 4: Define locked Playbox tokens in Tailwind

**Files:** `tailwind.config.js`, `constants/theme.ts` (create)

**Step 1:** Replace `tailwind.config.js`:

```js
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        paper:  '#f5f5f5',
        ink:    '#572c57',
        mauve:  '#9f5f91',
        coral:  '#e26972',
        butter: '#f6ea98',
      },
      fontFamily: {
        display: ['Unbounded_700Bold'],
        'display-x': ['Unbounded_800ExtraBold'],
        sans:    ['Inter_400Regular'],
        medium:  ['Inter_500Medium'],
        semibold:['Inter_600SemiBold'],
        mono:    ['JetBrainsMono_400Regular'],
      },
      borderRadius: {
        xl: '20px',
        '2xl': '28px',
      },
    },
  },
  plugins: [],
};
```

**Step 2:** Create `constants/theme.ts` mirroring the palette as TS constants for places NativeWind can't reach (e.g. map markers, StatusBar):

```ts
export const palette = {
  paper:  '#f5f5f5',
  ink:    '#572c57',
  mauve:  '#9f5f91',
  coral:  '#e26972',
  butter: '#f6ea98',
} as const;

export const darkSurfaces = {
  bg:      palette.ink,
  fg:      palette.paper,
  accent:  palette.coral,
  warm:    palette.butter,
  muted:   palette.mauve,
} as const;
```

**Step 3: Commit**

```bash
git add -A && git commit -m "feat(theme): lock Playbox palette in Tailwind + theme constants"
```

---

### Task 5: Install display + body + mono fonts

**Step 1:** Run `npx expo install expo-font @expo-google-fonts/unbounded @expo-google-fonts/inter @expo-google-fonts/jetbrains-mono`

**Step 2:** Create `hooks/useLoadedFonts.ts`:

```ts
import { useFonts, Unbounded_700Bold, Unbounded_800ExtraBold } from '@expo-google-fonts/unbounded';
import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold } from '@expo-google-fonts/inter';
import { JetBrainsMono_400Regular } from '@expo-google-fonts/jetbrains-mono';

export function useLoadedFonts() {
  const [loaded] = useFonts({
    Unbounded_700Bold,
    Unbounded_800ExtraBold,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    JetBrainsMono_400Regular,
  });
  return loaded;
}
```

**Step 3:** In `app/_layout.tsx`, block render with `SplashScreen.preventAutoHideAsync()` until `useLoadedFonts()` returns `true`, then `SplashScreen.hideAsync()`.

**Step 4:** Verify with a test text `<Text className="font-display text-4xl text-ink">Playbox</Text>` on the home screen — should render in Unbounded.

**Step 5: Commit**

```bash
git add -A && git commit -m "feat(theme): load Unbounded + Inter + JetBrains Mono"
```

---

## Phase 2 — Navigation scaffold

### Task 6: Create Expo Router groups

**Files:**
- Create: `app/(onboarding)/_layout.tsx`, `app/(tabs)/_layout.tsx` (replace), `app/index.tsx` (replace).

**Step 1:** `app/(tabs)/_layout.tsx` — bottom tabs with three screens: `map` (home), `play` (active session / history), `profile`. Icons from `@expo/vector-icons` (Feather). Tab bar bg `paper`, active tint `coral`, inactive `mauve`, label font `Inter_500Medium`, tab bar height 64pt, rounded-top.

**Step 2:** `app/(tabs)/map.tsx`, `app/(tabs)/play.tsx`, `app/(tabs)/profile.tsx` — placeholder screens each with a centered Unbounded headline.

**Step 3:** `app/(onboarding)/_layout.tsx` — stack navigator, `headerShown: false`, gesture disabled.

**Step 4:** `app/_layout.tsx` root — decide initial route based on Clerk `isSignedIn`. For now, redirect unsigned to `/(onboarding)/welcome`, signed to `/(tabs)/map`. Clerk is wired in Task 11; for now stub `const isSignedIn = false`.

**Step 5: Commit**

```bash
git add -A && git commit -m "feat(nav): scaffold (onboarding) + (tabs) route groups"
```

---

## Phase 3 — i18n (Turkish source)

### Task 7: Wire i18next with TR source, EN translation

**Step 1:** Run `npx expo install i18next react-i18next expo-localization intl-pluralrules`

**Step 2:** Create `i18n/index.ts`:

```ts
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import * as Localization from 'expo-localization';
import tr from './locales/tr.json';
import en from './locales/en.json';
import 'intl-pluralrules';

const deviceLang = Localization.getLocales()[0]?.languageCode ?? 'tr';

i18n.use(initReactI18next).init({
  resources: { tr: { translation: tr }, en: { translation: en } },
  lng: deviceLang === 'en' ? 'en' : 'tr',
  fallbackLng: 'tr',
  interpolation: { escapeValue: false },
  returnNull: false,
});

export default i18n;
```

**Step 3:** Create `i18n/locales/tr.json` and `i18n/locales/en.json` with onboarding + tab keys (see Task 13–18 for content).

**Step 4:** Import `i18n` at top of `app/_layout.tsx`: `import '../i18n';`

**Step 5: Commit**

```bash
git add -A && git commit -m "feat(i18n): wire i18next with Turkish source + English translation"
```

---

### Task 8: Create `useT` hook + typed key helper

**Files:** `hooks/useT.ts`

```ts
import { useTranslation } from 'react-i18next';
export function useT() {
  const { t, i18n } = useTranslation();
  return { t, lang: i18n.language, setLang: i18n.changeLanguage };
}
```

**Commit:** `git commit -am "feat(i18n): add useT hook"`

---

## Phase 4 — Auth (Clerk)

### Task 9: Install Clerk + SecureStore

**Step 1:** Run `npx expo install @clerk/clerk-expo expo-secure-store`

**Step 2:** Create `.env.example`:

```
EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_xxx
EXPO_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=xxx
EXPO_PUBLIC_GOOGLE_MAPS_IOS_KEY=xxx
EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY=xxx
```

**Step 3:** Create `lib/clerk-token-cache.ts`:

```ts
import * as SecureStore from 'expo-secure-store';

export const tokenCache = {
  async getToken(key: string) {
    try { return await SecureStore.getItemAsync(key); }
    catch { return null; }
  },
  async saveToken(key: string, value: string) {
    try { await SecureStore.setItemAsync(key, value); } catch {}
  },
};
```

**Step 4:** Wrap `app/_layout.tsx` with `<ClerkProvider publishableKey={process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY!} tokenCache={tokenCache}>`.

**Step 5:** Replace the stubbed `isSignedIn` with Clerk's `useAuth().isSignedIn`. Gate the redirect on `isLoaded`.

**Step 6: Commit**

```bash
git add -A && git commit -m "feat(auth): wire ClerkProvider with SecureStore token cache"
```

---

## Phase 5 — Onboarding flow (Turkish-first)

Use Turkish as source copy. Each screen uses `useT()` with keys prefixed `onb.*`.

### Task 10: Welcome slide — `app/(onboarding)/welcome.tsx`

**Content (tr.json):**
```json
{
  "onb": {
    "welcome": {
      "eyebrow": "merhaba",
      "title": "oyna.\niade et.\ntekrar oyna.",
      "sub": "şehrin her yerinde spor ekipmanı. anında, ücretsiz, cebinde.",
      "cta": "başla"
    }
  }
}
```

**Layout:** `flex-1 bg-paper px-6 pt-24`. Eyebrow in `font-medium text-mauve uppercase tracking-widest`. Title in `font-display-x text-ink text-6xl leading-[0.9]` with `\n` respected. Sub in `font-sans text-ink/70 text-lg mt-6`. CTA pinned bottom, `bg-coral text-paper py-5 rounded-2xl font-semibold text-center` — haptic `Haptics.impactAsync(Medium)` on press, then `router.push('/(onboarding)/intro-map')`.

**Commit:** `git commit -am "feat(onb): welcome slide"`

---

### Task 11: Intro slide 2 — map teaser — `app/(onboarding)/intro-map.tsx`

**Copy:**
```json
"intro_map": {
  "title": "yakınındaki\nistasyonlar",
  "sub": "top, raket, paddle — hepsi cepten görünür mesafede."
}
```

**Visual:** A non-interactive MapView preview (or static image fallback) centered on Taksim Meydanı, three animated pulse markers in `coral`. Use Reanimated shared value for pulse. CTA `devam` → `/(onboarding)/intro-social`.

**Commit:** `git commit -am "feat(onb): map teaser slide with pulse markers"`

---

### Task 12: Intro slide 3 — streaks/social — `app/(onboarding)/intro-social.tsx`

**Copy:**
```json
"intro_social": {
  "title": "arkadaşlarınla\nseri yap",
  "sub": "haftalık şehir sıralaması. takip et, geç, övün."
}
```

**Visual:** Stacked fake leaderboard cards in `butter` with mauve avatars, Reanimated stagger entrance. CTA `hadi başlayalım` → `/(onboarding)/permissions`.

**Commit:** `git commit -am "feat(onb): social/streaks intro slide"`

---

### Task 13: Permissions — `app/(onboarding)/permissions.tsx`

Request location (`expo-location`), notifications (`expo-notifications`), camera (`expo-camera`). Each shown as a card with icon, `font-display` title, `font-sans` rationale. Tapping asks for permission; card becomes `butter` background + checkmark when granted. CTA enabled only after location is granted (others optional but recommended).

**Copy:**
```json
"perms": {
  "title": "birkaç izin",
  "location": { "title": "konum", "why": "en yakın istasyonu bulmak için" },
  "notif":    { "title": "bildirim", "why": "iade süresi dolmadan hatırlatmak için" },
  "camera":   { "title": "kamera", "why": "istasyondaki qr'ı okumak için" },
  "cta": "tamam, devam"
}
```

**Commit:** `git commit -am "feat(onb): permissions screen with granular consent"`

---

### Task 14: Phone entry — `app/(onboarding)/phone.tsx`

Clerk `useSignUp()`. Turkish phone input, country locked to +90, `libphonenumber-js` for format validation.

**Step 1:** `npx expo install libphonenumber-js`

**Step 2:** Copy:
```json
"phone": {
  "title": "telefonun?",
  "sub": "sms ile doğrulama kodu göndereceğiz.",
  "placeholder": "5xx xxx xx xx",
  "cta": "kod gönder"
}
```

**Step 3:** On CTA: `signUp.create({ phoneNumber: '+90' + digits })` then `signUp.preparePhoneNumberVerification({ strategy: 'phone_code' })`, navigate to `/(onboarding)/otp?phone=...`.

**Commit:** `git commit -am "feat(auth): phone entry with Clerk signUp"`

---

### Task 15: OTP verify — `app/(onboarding)/otp.tsx`

6-digit input (auto-advance, paste detection, autofill via `textContentType="oneTimeCode"`). On complete: `signUp.attemptPhoneNumberVerification({ code })`. On success: `setActive({ session: signUp.createdSessionId })` → `/(onboarding)/handle`. Countdown for resend (60s, `font-mono`). Haptic `Success` on verify, `Error` on failure.

**Copy:**
```json
"otp": {
  "title": "kodu gir",
  "sub": "{{phone}} numarasına gönderdiğimiz 6 haneli kod.",
  "resend": "tekrar gönder",
  "resend_in": "{{s}}s sonra tekrar"
}
```

**Commit:** `git commit -am "feat(auth): OTP verify with Clerk + autofill"`

---

### Task 16: Handle capture — `app/(onboarding)/handle.tsx`

Name + @handle (3–20 chars, a-z0-9_). Validation inline. On submit: `user.update({ firstName, username })`. Then `router.replace('/(tabs)/map')`.

**Copy:**
```json
"handle": {
  "title": "seni nasıl çağıralım?",
  "name_label": "isim",
  "handle_label": "kullanıcı adı",
  "cta": "bitir"
}
```

**Commit:** `git commit -am "feat(onb): handle capture + handoff to app"`

---

## Phase 6 — Map home that feels alive

### Task 17: Seed placeholder stations

**Files:** `data/stations.seed.ts`

30 stations across İstanbul (Taksim, Kadıköy, Beşiktaş, Moda, Bebek, Maçka Parkı, Caddebostan, Bağdat Cd., Levent, Ataşehir), Ankara (Kuğulu Park, Tunalı, Çankaya, ODTÜ), İzmir (Kordon, Alsancak, Bostanlı, Karşıyaka). Each with `id`, `name`, `city`, `lat`, `lng`, `sports: ('football'|'basketball'|'volleyball'|'paddle'|'tennis')[]`, `stock: Record<sport, number>`, `availableNow: boolean`.

**Commit:** `git commit -am "data: seed 30 placeholder stations across 3 cities"`

---

### Task 18: Install maps + location

**Step 1:** Run `npx expo install react-native-maps expo-location`

**Step 2:** Add to `app.json` → `expo.plugins`:

```json
["expo-location", {
  "locationAlwaysAndWhenInUsePermission": "Playbox yakınındaki istasyonları göstermek için konumunu kullanır."
}]
```

**Step 3:** Add `expo.ios.config.googleMapsApiKey` and `expo.android.config.googleMaps.apiKey` (pulling from env via EAS — for now leave placeholder).

**Commit:** `git commit -am "chore(maps): install react-native-maps + expo-location"`

---

### Task 19: Build the Map screen — `app/(tabs)/map.tsx`

**The "wow" requirements:**
- On mount: get user location, animate camera to it over 900ms spring.
- Stations render as custom markers (not default pins): a `butter` rounded square with a sport emoji and a small `coral` dot if `availableNow`.
- Markers stagger-fade-in (Reanimated, 40ms between).
- A floating top pill shows city name + station count: `"İstanbul · 18 istasyon aktif"`, `font-medium`, blurred background (`BlurView intensity={40}`).
- Bottom filter chip row (horizontal scroll) for sport filter: `futbol`, `basket`, `voleybol`, `paddle`, `tenis`. Active chip = `ink` bg / `paper` text, inactive = `paper` bg + `ink/20` border.
- Tapping a marker springs a bottom sheet preview (`@gorhom/bottom-sheet`) with station name, walking time (rough haversine × 12 min/km), sport stock chips.

**Step 1:** `npx expo install @gorhom/bottom-sheet expo-blur`

**Step 2:** Implement in pieces — commit after each:
- 19a: map + user location + camera animation → commit
- 19b: custom markers + stagger entrance → commit
- 19c: top city pill with BlurView → commit
- 19d: filter chip row + filter state (Zustand store in `stores/mapStore.ts`) → commit
- 19e: bottom sheet station preview → commit

---

### Task 20: Wire haptics on all meaningful taps

**Step 1:** `npx expo install expo-haptics`

**Step 2:** Create `lib/haptics.ts`:
```ts
import * as Haptics from 'expo-haptics';
export const hx = {
  tap:   () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light),
  press: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium),
  punch: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy),
  yes:   () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
  no:    () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error),
};
```

**Step 3:** Call `hx.press()` on all primary CTAs, `hx.tap()` on chip/tab taps, `hx.yes()` on OTP success.

**Commit:** `git commit -am "feat(ux): haptics on every meaningful tap"`

---

## Phase 7 — Supabase client stub + README

### Task 21: Supabase client with Clerk JWT bridge

**Step 1:** `npx expo install @supabase/supabase-js`

**Step 2:** Create `lib/supabase.ts`:

```ts
import { createClient } from '@supabase/supabase-js';
import { useAuth } from '@clerk/clerk-expo';

export function useSupabase() {
  const { getToken } = useAuth();
  return createClient(
    process.env.EXPO_PUBLIC_SUPABASE_URL!,
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: {
        fetch: async (url, opts = {}) => {
          const token = await getToken({ template: 'supabase' });
          const headers = new Headers(opts.headers);
          if (token) headers.set('Authorization', `Bearer ${token}`);
          return fetch(url, { ...opts, headers });
        },
      },
    }
  );
}
```

**Commit:** `git commit -am "feat(db): Supabase client with Clerk JWT template"`

---

### Task 22: README + final verification

**Step 1:** Write `README.md` with: what Playbox is, prereqs (Node 20, pnpm/npm, Xcode, Android Studio, Clerk account, Supabase project, Google Maps keys), `.env` setup referencing `.env.example`, `npx expo start` / `npx expo run:ios` / dev-client notes for BLE future.

**Step 2:** Final verification pass:
- `npx expo start` — app boots
- Fresh install flow: onboarding → phone OTP (use Clerk test mode) → map
- All copy renders in Turkish on a Turkish-locale device
- Switch device lang to English — copy switches
- Toggle dark mode → colors invert correctly (ink bg, paper fg)
- Every CTA gives haptic feedback on a real device
- Map stagger-entrance runs at 60fps
- Lint + typecheck clean: `npx tsc --noEmit && npx expo lint`

**Step 3:** Final commit: `git commit -am "docs: README + v1 scaffold complete"`

---

## Definition of done

- Fresh user can complete onboarding in < 45 seconds.
- Map screen renders user location + 30 stations with stagger entrance in < 1s after auth.
- Every tap gives haptic feedback.
- Zero spinners — skeleton or stagger-fade only.
- Turkish is the source of truth; English renders when device locale is `en`.
- Dark mode works without a single hardcoded color.
- Typecheck and lint pass clean.

---

## Follow-up plans (NOT in this one)

1. `2026-04-XX-supabase-schema.md` — stations/sessions/friends tables + RLS with Clerk JWT.
2. `2026-04-XX-unlock-flow.md` — QR scan + BLE stub + active session timer.
3. `2026-04-XX-profile-streaks.md` — play history, shareable IG story card, weekly leaderboard.
4. `2026-05-XX-operator-dashboard.md` — separate Next.js app for partners.
