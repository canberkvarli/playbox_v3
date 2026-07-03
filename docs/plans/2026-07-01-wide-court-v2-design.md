# Playbox Design v2 — "Wide Court" (light-first)

**Date:** 2026-07-01
**Supersedes:** the dark-first Asphalt Volt pass where it conflicts (theme + font).
**Driver:** iterate off tester feedback — lighter, distinct-from-Equip, new display font.

## Decisions

### 1. Theme — LIGHT default + dark toggle
- Light is the default. Dark is a toggle in settings.
- Light neutrals: bg `#F4F3EE` (cream), surface `#FFFFFF`, surfaceAlt `#F4F3EE`, text `#2A2C33`, muted `#6B6B75`, border `#E2E0D8`. Accents unchanged: **volt `#D6FB3C`**, **coral `#FF5C39`**.
- Mechanism (avoids refactoring ~980 static `palette.X` refs): `palette` becomes a mutable singleton seeded light; `applyScheme(scheme)` `Object.assign`s the new ramp; a persisted theme store holds the preference; the root remounts (`key={scheme}`) on toggle so every static ref re-reads. `useTheme()` + tailwind mirror the same values.
- On volt, text stays `voltInk` (#17181C) in both themes.

### 2. Display font — Archivo Expanded ("Wide Court")
- Replaces Anton for all titles/headlines. Inter (UI) + JetBrains Mono (technical) unchanged.
- Loaded under the legacy `Unbounded_700Bold` / `Unbounded_800ExtraBold` keys (same alias trick) so every existing headline style picks it up with no per-file churn.
- Sourcing: no `@expo-google-fonts/archivo-expanded` package exists → bundle the Archivo Expanded static TTFs in `assets/fonts/` (SemiBold/Bold/ExtraBold). Fallback if unfetchable: user drops the TTFs in Downloads.
- Wide letterforms → revisit line-heights (Archivo Expanded is less top-heavy than Anton; likely dial back the 1.3× to ~1.15×).

### 3. PLAYBOX wordmark
- Reusable `<Wordmark>`: `play` in fg (dark on light / white on dark), `box` in **volt**. Used on the map header and brand spots.

### 4. Navigation — redesigned slide-in drawer (not full-screen)
- Keep the left slide-in, restyle hard so it doesn't read like Equip:
  - Top: avatar + name + a **settings icon** (replaces the "ayarlar" text row).
  - Nav list: Archivo Expanded labels, new order, staggered spring-in motion.
  - **Share** = a distinct animated tile (not a plain list row).
  - **destek** pinned bottom-left (kept, restyled).

### 5. Oyna (active session) — immersive focus timer
- Full-bleed: huge Archivo countdown, volt progress ring, subtle live pulse animation, minimal chrome, coral `SEANSI BİTİR`.
- Idle (no session): strong centered empty state — big Archivo headline + the captivating, **centered**, larger `haritayı aç` CTA.

### 6. Map markers — stacked mini sport balls
- Up to 3 tiny sport balls clustered in the teardrop pin. No `+N` overflow.

### 7. Fixes
- **Profile avatar** touching the header → rework header spacing/layout.
- **Gradient bug** (`ViewManagerAdapter_ExpoLinearGradient` + 🔥 raw text): replace the truthy-`LinearGradient` check with `requireOptionalNativeModule('ExpoLinearGradient')` capability check → solid coral when the native view is absent.
- **Icon:** build #28 finished + submitted; lands when installed from TestFlight (native, not OTA).

## Delivery
- Theme, font (bundled assets), wordmark, drawer, oyna, markers, gradient-fix are all **JS/asset** → OTA-able (no new native modules beyond expo-linear-gradient, already in #28).
- Icon still requires installing build #28.

## Rollout
1. Theme system (light default + toggle) — foundational, everything sits on it.
2. Archivo Expanded font + line-height retune.
3. Wordmark component.
4. Drawer redesign.
5. Oyna immersive timer + idle state + centered CTA.
6. Map markers.
7. Profile header fix + gradient capability guard.
8. Typecheck, OTA, (icon via #28 install).
