# Asphalt Volt — Design Update

**Date:** 2026-06-30
**Source of truth:** `~/Downloads/Playbox Design.html` ("Playbox — App Store Images", reskin titled *Asphalt Volt*)
**Scope:** Full app reskin. Dark-default + light fallback.
**Token strategy:** Fast remap — keep legacy palette key NAMES (no file churn across 43 importers); shift VALUES to Asphalt Volt and add dark/light resolution.

## Identity

Dark-first, high-energy. Near-black "asphalt" courts, electric "volt" lime as the
primary action color, coral reserved for destructive. Anton condensed uppercase
for display headlines, Inter for UI, JetBrains Mono for technical labels
(station codes, counts, timers).

## Tokens (exact, from design file)

| Role | Token | Dark | Light |
|------|-------|------|-------|
| App background | `--bg` / `asphalt` | `#17181C` | `#F4F3EE` |
| Card / surface | `--card` / `surface` | `#202127` | `#FFFFFF` |
| Surface alt | — | `#23252e` | `#F4F3EE` |
| Deepest | — | `#0D0D10` | — |
| Primary text (fg) | `--paper`/`--slate` | `#F4F3EE` | `#2A2C33` |
| Muted text | `--muted` | `#9a9aa6` | `#6b6b75` |
| Border | — | `#3a3c45` | `#E2E0D8` |
| **Primary action** | `--volt` | `#D6FB3C` | `#D6FB3C` |
| **Destructive** | `--coral` | `#FF5C39` | `#FF5C39` |
| Danger bg | — | `#2a1215` | `#FDE7E2` |

### Legacy-key remap (values only; names unchanged)

| Legacy key | Old value | New value / role |
|---|---|---|
| `paper` (bg) | cream | `#17181C` asphalt (dark) / `#F4F3EE` (light) |
| `ink` (text/UI) | plum | `#F4F3EE` fg (dark) / `#2A2C33` (light) |
| `coral` (primary) | coral | **`#D6FB3C` volt** — primary CTAs become lime |
| `butter` (warm 2nd) | tangerine | **`#FF5C39` coral** — destructive/accent |
| `mauve` (cool 2nd) | teal | `#9a9aa6` muted |
| `surface` (new) | — | `#202127` (dark) / `#FFFFFF` (light) |

## Type

- **Display:** Anton (`Anton_400Regular`, single weight) — uppercase, tight tracking.
  Replaces Unbounded everywhere (`font-display`, inline `Unbounded_700Bold` / `Unbounded_800ExtraBold`).
- **UI:** Inter (existing — Regular/Medium/SemiBold/Bold).
- **Mono:** JetBrains Mono (existing) — technical labels, `.22em` tracking, uppercase.

## Radii

pills `999px` · cards `24–44px` · app-icon tile `64px` · small chips `8px`.

## Dark/light mechanism

App is currently light-locked (`darkMode: 'class'`, `useColorScheme` disabled).
Flip to **dark-default**: a `useColorScheme`-driven theme resolver returns the
per-scheme value for each token; defaults to dark when unset. NativeWind `dark:`
variants enabled with dark as the default class.

## Components / primitives

- `Button` — volt primary (dark text), coral danger, outline ghost. Pill radius.
- `Surface` / `Card` — `#202127`, hairline `#3a3c45` border, large radius.
- `Tag` / `Pill` — sport chips, mono labels.
- `SelectRow` — sport-select list rows (volt border + dot when active).
- `CircularTimer` — volt progress ring, mono countdown.
- `MapPin` — volt/coral location markers.
- Screen `Header` — Anton uppercase headline + mono kicker.

## Rollout order

1. Foundation: `theme.ts` remap + resolver, `tailwind.config.js` sync, load Anton, replace Unbounded.
2. Primitives.
3. Tabs: map / play / profile.
4. Station / BLE unlock / session-prep / active session.
5. Onboarding (9 screens).
6. settings / support / payments / card-add / profile detail.
7. Render-verify each cluster against the mockup.

## Verification

Render screens via Playwright/Expo web (or simulator screenshots) and compare to
the four mockup frames: Harita, Aç (BLE), Aktif seans, app icon.
