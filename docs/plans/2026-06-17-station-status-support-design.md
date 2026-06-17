# Station status + support UX redesign — 2026-06-17

## Context

Stations are detected **BLE-only**. The ESP32 brains are Bluetooth-only with no
WiFi/internet, so there is no server-side heartbeat. From the phone's point of
view, "station off" and "station out of range" are indistinguishable — both mean
**no fresh BLE sighting**. We lean into that: it collapses the old
"kontrol ediliyor / menzilde / menzil dışında" limbo into two honest states —
**Açık** (heard over BLE right now) and **Kapalı** (not heard).

Today there is exactly one real station (dev workshop). All other map stations
are seed data with no ESP32, so they are always Kapalı. We keep them on the map
(muted) so it looks alive / "coming soon".

UI is Turkish-locked.

## Goals

1. Map markers show a clear **status pill** (`● Açık` / `○ Kapalı`) instead of a
   bare red corner dot, driven only by live BLE presence.
2. Station detail screen has two clean states and drops repeated "kontrol" copy.
3. Support entry button on station detail aligns on one baseline.
4. Support screen İletişim contact rows read as a clean aligned list.

## Design

### 1. Map markers — `app/(tabs)/map.tsx` (~133–148)
- Replace the corner dot with a small rounded **status pill** inside the marker
  card.
- **Açık**: green (`#22c55e`), filled dot + soft glow/shadow — only when there is
  a fresh BLE sighting (`nearby` / `isFreshlyPresent`).
- **Kapalı**: muted grey (`palette.ink + '55'`), hollow dot — default.
- **Remove** the `availableNow` (seed) coral dot — static data no longer implies
  open. Only live BLE = Açık.
- Background passive scan already runs on map focus; walking closer flips the
  pill. No new polling.

### 2. Station detail — `app/station/[id].tsx` + `components/StationGateSelector.tsx`
- Remove "kontrol ediliyor" copy in the header label (`[id].tsx:91`) and the CTA
  fallback (`StationGateSelector.tsx:429`).
- **Two states:**
  - **Açık** (BLE heard): header `● Açık`; slot picker + **Oyna** as today.
  - **Kapalı** (not heard): header `○ Kapalı`, calm hint *"yaklaşınca açılır"*,
    slots + Play hidden.
- **~1.5s settle on first mount**: show a neutral skeleton until the first scan
  window resolves, so we never flash Kapalı when actually in range.
- Collapse CTA label variants to: **Oyna** (open + slot picked), **bir kapı seç**
  (open, no slot), nothing (closed). Drop menzilde/menzil dışında/kontrol.

### 3. Support entry button — `app/station/[id].tsx` (~329–358)
- Icon + "sorun mu var? destek al" on one baseline; fix vertical alignment /
  wrapping. Centered, subtle.

### 4. Support contact rows — `app/support.tsx` `ChannelButton` (~63–142)
- Each row: fixed icon badge → label + sublabel column (flex) → chevron, all
  vertically centered on one line. Tighten WhatsApp / telefon / e-posta spacing.

## Out of scope
- Any firmware or Supabase heartbeat work (ESP32 is BLE-only — "next level").
