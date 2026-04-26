# Playbox Reservation System — Design

**Date:** 2026-04-26
**Author:** brainstormed with the assistant
**Status:** validated, ready for implementation plan
**Scope:** v1 reservation system for instant ("reserve-now") 30-minute station holds with refundable card pre-auth, two-tier abuse protection, and first-time onboarding slides + terms acceptance.

This doc captures decisions only. The follow-up implementation plan will translate it into ordered tasks.

---

## 1. Summary

Users can reserve a specific gate at a station for 30 minutes by tapping "rezerv et". A ₺20 hold is pre-authorised on their saved card at reservation time. If they scan the gate's QR within 30 minutes, the hold is released and the session's own pre-auth takes over. If they no-show or cancel after a 2-minute grace window, the hold is captured. Repeat no-shows trigger escalating time-locks. Authority lives in Supabase; the client store is a cache.

## 2. Decisions (the 9 brainstorm checkpoints)

| # | Question | Decision |
|---|----------|----------|
| 1 | Reservation modes | **Reserve-now only** for v1. Future-date scheduling is a separate v2 product. |
| 2 | Cost model | **Refundable Iyzico pre-auth** (₺20). Reuses existing `iyzico-preauth` / `iyzico-capture-release` plumbing. |
| 3a | Free-cancel grace | **2 minutes** from reservation creation. |
| 3b | Capture/release rules | See §3 state machine. Scan-before-expiry releases. No-show captures. Station fault releases. |
| 4 | Onboarding pattern | **Hybrid:** full slide deck on first reservation (4 slides + 1 agree checkbox); compact mini-confirm sheet on every subsequent reservation. Terms versioned. |
| 5 | Hold amount | **₺20 flat across all sports**, stored in `app_config` row, tunable without release. |
| 6a | Abuse tiers | **Capture tiers + velocity caps.** 3 captures / 30d → 24h lock; 5 captures / 30d → 7d lock; 10 captures / 90d → manual review. Plus 3/hour and 8/day reservation rate limit. |
| 6b | Capture failure (card declined) | **Hard-lock new reservations** until user updates card and retry succeeds. |
| 7 | Authority | **Server-of-truth in Supabase.** pg_cron sweeper every 60s + lazy sweep on read. Client store becomes cache. |
| 8 | Gate assignment | **Specific-gate at reservation time.** `gate_id` is non-nullable. Existing `StationGateSelector` becomes part of the reserve flow. |
| 9 | Notifications | **Full set (5 events)** via Expo Push: T-5 reminder, capture confirmation, system-fault release, capture-failure card alert, tier-lock applied. |

## 3. State machine

```
                           ┌─────────────┐
   reserve()  ─────────►   │   active    │
                           └──────┬──────┘
                                  │
   ┌──────────────────────────────┼──────────────────────────────────┐
   ▼                              ▼                                  ▼
within 2-min grace        scan QR before expiry              cancel after grace
       │                          │                                  │
       ▼                          ▼                                  ▼
release-hold              release-hold                       capture-hold
status=cancelled          status=consumed                    status=expired_captured
                          (session takes over)               +tier counter

                                  │
                                  ▼  (no event before expires_at)
                       expiry sweep (pg_cron)
                                  │
                          ┌───────┴────────┐
                          ▼                ▼
                  capture succeeds   capture fails
                  status=expired_    status=expired_
                  captured           captured + lock_reason=
                  +tier counter      payment_failed (hard-lock)
```

Force-majeure release path (station offline, gate hardware fault detected by infra) → operator-triggered API call → release hold + status=`expired_released` + system-fault notification.

## 4. Data model

All tables live in Supabase Postgres. RLS is on. Reads scoped by `auth.uid()`. **Writes only via edge functions.** Direct client INSERT/UPDATE is denied.

### 4.1 `reservations`

```sql
create table reservations (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  station_id      uuid not null references stations(id),
  sport           sport_enum not null,
  gate_id         text not null,            -- specific gate, per Q8
  hold_id         text,                     -- iyzico hold reference
  hold_amount_try int not null,             -- snapshot of app_config at create time
  terms_version   int not null,             -- snapshot, for dispute defensibility
  status          reservation_status not null default 'active',
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null,
  terminal_at     timestamptz,              -- when the row entered a terminal state
  client_meta     jsonb                     -- app version, device, locale
);

create type reservation_status as enum (
  'active',
  'consumed',           -- scanned, session started
  'cancelled',          -- user cancelled within grace
  'expired_captured',   -- expired, hold captured (no-show)
  'expired_released'    -- system fault path
);

-- one active reservation per user
create unique index reservations_one_active_per_user
  on reservations(user_id) where status = 'active';

-- one active reservation per (station, gate)
create unique index reservations_one_active_per_gate
  on reservations(station_id, gate_id) where status = 'active';

-- fast sweep query
create index reservations_active_expiring on reservations(expires_at)
  where status = 'active';
```

### 4.2 `reservation_events` (append-only audit log)

```sql
create table reservation_events (
  id              bigserial primary key,
  reservation_id  uuid not null references reservations(id),
  kind            text not null,   -- 'created' | 'grace_cancel' | 'cancel_after_grace'
                                   -- | 'consumed' | 'expired_capture_ok' | 'expired_capture_fail'
                                   -- | 'system_fault_release' | 'tier_lock_triggered'
                                   -- | 'capture_retry_ok' | 'capture_retry_fail'
  payload         jsonb,           -- iyzico response, retry count, etc.
  at              timestamptz not null default now()
);

create index reservation_events_by_reservation on reservation_events(reservation_id, at);
```

Events are how disputes get resolved and how we measure abuse signals later. **Never delete; never update.**

### 4.3 `user_reservation_locks`

```sql
create table user_reservation_locks (
  user_id                uuid primary key references auth.users(id) on delete cascade,
  locked_until           timestamptz not null,
  reason                 lock_reason not null,
  triggered_by_id        uuid references reservations(id),
  created_at             timestamptz not null default now()
);

create type lock_reason as enum (
  'tier_24h',           -- 3 captures in 30d
  'tier_7d',            -- 5 captures in 30d
  'manual_review',      -- 10 captures in 90d, until support clears
  'payment_failed'      -- card declined on capture, until card updated + retry succeeds
);
```

Only one active lock per user. New tier crossings *replace* the existing lock if more severe; less severe never downgrades a more severe one. `manual_review` and `payment_failed` use `locked_until = 'infinity'` and are cleared by their respective resolution paths.

### 4.4 `terms_acceptances`

```sql
create table terms_acceptances (
  user_id        uuid not null references auth.users(id) on delete cascade,
  terms_version  int not null,
  accepted_at    timestamptz not null default now(),
  app_version    text,
  ip             inet,
  primary key (user_id, terms_version)
);
```

Used to gate the slide deck: if `(auth.uid(), current terms_version)` row exists, skip slides; else show. Bump `terms_version` in `app_config` to force re-acceptance.

### 4.5 `app_config`

```sql
create table app_config (
  key    text primary key,
  value  jsonb not null,
  updated_at timestamptz not null default now()
);

-- seeded values
insert into app_config (key, value) values
  ('reservation_hold_try',   '20'::jsonb),
  ('reservation_lock_min',   '30'::jsonb),
  ('grace_seconds',          '120'::jsonb),
  ('terms_version',          '1'::jsonb),
  ('velocity_per_hour',      '3'::jsonb),
  ('velocity_per_day',       '8'::jsonb),
  ('tier1_captures',         '3'::jsonb),
  ('tier1_window_days',      '30'::jsonb),
  ('tier1_lock_hours',       '24'::jsonb),
  ('tier2_captures',         '5'::jsonb),
  ('tier2_window_days',      '30'::jsonb),
  ('tier2_lock_days',        '7'::jsonb),
  ('tier3_captures',         '10'::jsonb),
  ('tier3_window_days',      '90'::jsonb);
```

Read by edge functions on each invocation (cheap; 2-row table).

## 5. Edge functions

All extend the existing `iyzico-*` set. All require an authenticated Supabase JWT.

### 5.1 `reservation-create`

**Input:** `{ station_id, sport, gate_id }`

**Validates (in order, fail-fast):**
1. User has a card on file (`paymentStore.cardStatus = on_file`).
2. No active session for this user.
3. No active reservation for this user.
4. No active lock for this user (`user_reservation_locks.locked_until > now()`).
5. Terms accepted at current `terms_version`.
6. Velocity: count of reservations created by user in last 1h ≤ `velocity_per_hour - 1`. Same for 24h ≤ `velocity_per_day - 1`. Counts include cancelled and expired (the limit is on *attempts*, not active state).
7. Station exists and offers this sport.
8. Gate is active for this sport (no existing active reservation on the same `(station_id, gate_id)`, and no in-progress session on the same gate). Use `select … for update` on the gate's relevant rows or a Postgres advisory lock on `hash(station_id, gate_id)` to prevent two clients winning the same gate.

**Then:**
9. Call `iyzico-preauth` for `reservation_hold_try`. If it fails → return 402 with iyzico error code; do not write a reservation row.
10. Insert `reservations` row with `expires_at = now() + reservation_lock_min`, `hold_id` from preauth.
11. Insert `reservation_events` row `kind='created'`.
12. Schedule a T-5 push notification (see §7).
13. Return the row.

**Returns:** `Reservation` row.

### 5.2 `reservation-cancel`

**Input:** `{ reservation_id }`

**Validates:** reservation belongs to caller, status = `active`.

**Behaviour:**
- If `now() - created_at < grace_seconds`: call `iyzico-capture-release` (release path), set status = `cancelled`, log `grace_cancel`. No tier counter increment.
- Else: call `iyzico-capture-release` (capture path), set status = `expired_captured`, log `cancel_after_grace`, increment tier counters, possibly apply lock.

### 5.3 `reservation-consume`

**Input:** `{ reservation_id }`. Called by the QR scan flow after the user successfully scans the *correct* gate.

**Validates:** reservation belongs to caller, status = `active`, `now() < expires_at`, scanned `gate_id` matches `reservation.gate_id`.

**Behaviour:** call `iyzico-capture-release` (release path), set status = `consumed`, log `consumed`. Session creation proceeds as today.

### 5.4 `reservation-sweep` (pg_cron, every 60s)

**Query:** `select * from reservations where status='active' and expires_at <= now()` — limit 200 per run.

**For each:**
1. Call `iyzico-capture-release` (capture path).
2. On success: status = `expired_captured`, log `expired_capture_ok`, increment tier counters, possibly apply lock.
3. On failure: status = `expired_captured`, log `expired_capture_fail` with iyzico error, apply `payment_failed` lock with `locked_until='infinity'`.
4. Send capture-confirmation or capture-failure push (see §7).

The sweeper is idempotent — re-running on the same row finds it already non-active and skips.

### 5.5 `reservation-retry-capture`

**Input:** `{ reservation_id }`. Called by the client after the user updates their card and the app detects a `payment_failed` lock.

**Behaviour:** retry `iyzico-capture-release` capture. On success: clear `payment_failed` lock, log `capture_retry_ok`. On failure: log `capture_retry_fail`, lock stays.

### 5.6 Lazy sweep helper

Every read of the user's reservations (the reservations screen, the home banner, the station screen) calls `reservation-sweep` first, scoped to that user only. Cheap, defends against pg_cron lag.

### 5.7 RPC for the client

A read-only RPC `get_my_reservation_state()` returns:

```ts
{
  active: Reservation | null,
  recent: Reservation[],          // last 10 terminal rows
  lock: UserReservationLock | null,
  terms_version_required: number, // from app_config
  terms_version_accepted: number | null,
  hold_amount_try: number,        // current config snapshot
}
```

This is what the reservation screen hydrates from. One round-trip.

## 6. Client surfaces

### 6.1 First-time slide deck

Reuses the `session-prep` 4-step pattern at [app/session-prep/[stationId]/[sport].tsx](app/session-prep/[stationId]/[sport].tsx). New route: `app/reserve/[stationId]/[sport]/[gateId].tsx`.

Slides:

1. **"Rezerv et, sonra git"** — what reservation does + 30-min lock window. Icon: `lock`.
2. **"₺20 bloke edilir, gelince serbest kalır"** — explain the hold mechanic. Icon: card with refresh-arrow.
3. **"Gelmezsen ₺20 tahsil edilir"** — the no-show capture rule. Icon: `clock-x`. Coral background to flag importance.
4. **"İlk 2 dakikada ücretsiz iptal"** — the safety net. Icon: undo-arrow.

Below slide 4: **single mandatory checkbox** *"Yukarıdaki şartları okudum ve kabul ediyorum."* Tapping "Rezerv et" while unchecked is a no-op with subtle shake.

On confirm: write `terms_acceptances` row (via `reservation-create` server-side; the client passes `agreed: true`). Subsequent reservations skip slides because the row exists.

When `terms_version` is bumped server-side, every user re-sees the slides on their next reservation attempt.

### 6.2 Mini-confirm sheet (every reservation)

A bottom sheet shown after the user picks gate, before reservation fires. One-liner:

> *Hold: ₺20 • Kilit: 30dk • İlk 2dk iptal serbest*

Two buttons: **rezerv et** (primary, ink) and **vazgeç** (ghost). No checkbox here — terms were accepted at v1.

### 6.3 Reservations screen ([app/reservations.tsx](app/reservations.tsx))

Already exists per recent commit. Refactor to:
- Hydrate from `get_my_reservation_state()` RPC, not from the client store.
- Show the active reservation with live countdown to expiry (already implemented).
- Show recent (last 10 terminal rows) — labelled by status: *Tamamlandı / İptal / Süresi Doldu / Sistem Hatası*.
- If `lock` is non-null, show a **lock banner** at top: *"Birkaç rezervasyonu kaçırdın. Yeni rezervasyon: HH:MM:SS sonra"* with countdown. For `manual_review`: *"Hesabını destekle birlikte gözden geçiriyoruz."* with a contact CTA. For `payment_failed`: *"Kartını güncellemen gerekiyor"* with a CTA to `/card-add`.

### 6.4 Reserve button states (on station card / station screen)

| State | Button copy | Behaviour |
|---|---|---|
| Has card, no lock, no active reservation | *"rezerv et"* | Opens slides (first time) or mini-confirm. |
| No card | *"kart ekle ve rezerv et"* | Routes to `/card-add` first. |
| Active reservation elsewhere | disabled, *"aktif rezervasyon var"* | Tap routes to `/reservations`. |
| Active session | hidden / replaced | Existing `ActiveSessionBanner` already covers this. |
| Tier lock | disabled, *"X saat sonra"* | Tap routes to `/reservations` to show full lock banner. |
| Payment-failed lock | disabled, *"kartını güncelle"* | Tap routes to `/card-add`. |
| Velocity cap hit | disabled, *"saatlik / günlük limit"* | Toast on tap. |
| Capacity exhausted (gate already reserved) | disabled, *"bu kapı dolu"* | Tap shows other gates. |

### 6.5 QR scan flow (existing)

On successful scan, before calling the existing session-start flow, check if there's an active reservation for this user on this gate. If yes → call `reservation-consume` first, then proceed to session-start. The session's own preauth replaces the released hold.

If the user has a reservation but scans a *different* gate at the same station → reject with *"Bu rezervasyon kapı X için. Doğru kapıyı tara."* (No silent re-routing — that breaks the specific-gate model.)

## 7. Notifications

Wire up `expo-notifications` (not yet installed per codebase scan). Push token registered on first foreground after sign-in, stored in `user_profiles.push_token`.

| Trigger | Sender | Copy (Turkish) | Notes |
|---|---|---|---|
| T-5 min before expiry | Scheduled at `reservation-create` time, fired by pg_cron at `expires_at - 5min` | *"Rezervasyonun 5 dakika içinde düşecek. İstasyona geldin mi?"* | Cancellable when reservation goes terminal early |
| Hold captured (no-show) | `reservation-sweep` on success | *"Vaktinde gelmedin, ₺20 tahsil edildi."* | Critical for trust |
| Hold released (system fault) | Force-majeure path | *"Sistemden kaynaklı bir sorun oldu, rezervasyonun iptal edildi. Ücret alınmadı."* | Rare |
| Capture failed | `reservation-sweep` on failure | *"Geçmiş rezervasyon ücreti kartından alınamadı. Devam etmek için kartını güncelle."* | Drives back to `/card-add` |
| Tier lock applied | After tier counter cross | *"Birkaç rezervasyonunu kaçırdın. Yeni rezervasyonlar 24 saat boyunca açılmayacak."* (variable per tier) | Without it, the next "rezerv et" tap fails mysteriously |

All notifications use [tr.json](i18n/locales/tr.json) — Turkish-locked per project rule. Keys to add: `notif.reservation_t5`, `notif.reservation_captured`, `notif.reservation_released`, `notif.reservation_capture_failed`, `notif.reservation_tier_lock`.

## 8. Edge cases & failure modes

| Case | Handling |
|---|---|
| User force-quits app right after `reservation-create` returns | Reservation row exists server-side; on next launch, `get_my_reservation_state` shows it. Client store rehydrates. |
| User scans gate exactly at expiry boundary | `reservation-consume` server-side check `now() < expires_at` is authoritative. Race goes to whichever arrives first; sweeper is idempotent. |
| Two clients race on the same gate | Postgres advisory lock + unique index on `(station_id, gate_id) where status='active'` — one wins, the other gets `409` and a clean retry suggestion. |
| User's card expires between `reservation-create` and capture | Capture fails → `payment_failed` lock → user updates card → `reservation-retry-capture`. |
| Iyzico is fully down | `reservation-create` fails fast; user sees clear error. Existing reservations expire on schedule; sweeper retries on a backoff (3 attempts over 24h) before giving up and applying `payment_failed` lock. |
| Station hardware reports gate jam during user's active reservation | Operator/internal API endpoint triggers `system_fault_release` — release the hold, status=`expired_released`, send notification, do not increment tier counter, do not apply lock. |
| User uninstalls and reinstalls during an active reservation | Server-of-truth means the reservation continues; on re-login, app surfaces it. T-5 push silently dropped if push token re-registration is needed. |
| Push token missing | Notifications silently dropped; in-app reservation screen still shows everything. T-5 reminder is convenience, not load-bearing. |
| pg_cron lag (delayed sweep) | Lazy sweep on user's next read closes the gap. User may briefly see "expired" status before capture happens — accept this; the row is correct within seconds. |
| Manual-review user contacts support | Support deletes their `user_reservation_locks` row + writes a `reservation_events` audit row referencing the lock removal. |

## 9. Security / abuse considerations

- **Direct DB writes blocked by RLS** — only the service role (used by edge functions) can write. Even a leaked anon key cannot create reservations or clear locks.
- **Velocity caps** prevent automated reservation spam.
- **Server-authoritative tier counters** mean the user cannot reset their no-show count by clearing app data.
- **`reservation_events` is append-only** — disputes are answerable from the audit log, not "trust me".
- **Card on file is required** before any reservation is possible — the existing `paymentStore.needsCardBeforeStart` gate extends to reservations.
- **Pre-auth amount is snapshotted** on the reservation row (`hold_amount_try`) — if `app_config` changes, in-flight reservations honor the value at create time.

## 10. Out of scope (explicit non-goals)

- **Future-date scheduled reservations.** Different mental model, different abuse vectors, separate v2 design.
- **Multi-user reservations** ("reserve a court for me + 3 friends"). Single-user only.
- **Reservation transfer / gifting.** Reservations are non-transferable.
- **Per-sport differential hold amounts.** Flat ₺20 across all sports until data justifies otherwise.
- **Adaptive deterrent (escalating hold for repeat offenders).** Tier-based time-locks cover the long tail without per-user pricing complexity.
- **Off-peak / surge pricing on the hold.** YAGNI for v1.
- **Web reservation UI.** Mobile only.

## 11. Open questions / config to confirm with operations

- Final wording for all 5 push notification copies (placeholder Turkish in §7 — check with whoever owns voice).
- Which support channel (WhatsApp / email / in-app) does the `manual_review` lock surface? — implied to use existing `app/support.tsx` flow.
- Capture retry policy for transient Iyzico failures: 3 attempts over 24h is an opinion, not law.
- Is the gate-jam force-majeure trigger going to come from station hardware telemetry (auto), an operator dashboard (manual), or both? Affects edge function shape but not data model.

## 12. Implementation phases (rough order — to be expanded into a plan)

1. **Schema migration** — tables 4.1–4.5 + RLS + seed `app_config`.
2. **Edge functions** — `reservation-create`, `reservation-cancel`, `reservation-consume` first; `reservation-sweep` and `reservation-retry-capture` second.
3. **Client store rewrite** — [stores/reservationStore.ts](stores/reservationStore.ts) becomes a server-state cache (TanStack Query is already installed per the supabase-schema doc); legacy local-only methods deleted.
4. **Slide deck route** — first-time onboarding at `/reserve/[stationId]/[sport]/[gateId]`.
5. **Mini-confirm sheet** — bottom sheet on subsequent reservations.
6. **Reservations screen refactor** — hydrate from RPC, surface lock banners.
7. **Reserve button state matrix** — wire all 8 states from §6.4 across station card + station screen + map.
8. **QR scan integration** — call `reservation-consume` before session start; reject mismatched gates.
9. **Push notifications** — install `expo-notifications`, register token, wire 5 triggers.
10. **pg_cron job** — install `reservation-sweep` cron @ 60s.
11. **Operator force-majeure endpoint** — small admin-only edge function for `system_fault_release`.
12. **i18n keys** — add notification keys + lock-banner keys to [i18n/locales/tr.json](i18n/locales/tr.json) and [en.json](i18n/locales/en.json).
13. **QA pass** — abuse simulation script (10 reservations, no-show all, verify tier locks fire). Card-decline simulation. Cron-lag simulation.

---

## Appendix A — Decision rationale anchors

- **Pre-auth model over free-with-tracking:** the iyzico preauth/capture/release path is already built and tested. Adding a wallet penalty is a config change, not a new payment integration. Self-policing means the abuse-tier system is a defense-in-depth layer rather than load-bearing.
- **Server-authoritative:** tier counters and locks must survive app reinstalls. Client state alone is unenforceable.
- **Specific-gate over pool:** user picked. Caveat: this design adds operational responsibility — when a gate breaks, support must do a refund + free re-reservation manually. We accept this in exchange for the simpler mental model and gate-by-gate availability display.
- **Single agree checkbox over split consent:** user picked. Slightly weaker for legal disputes but the slide deck itself is the primary "we told you" record, not the checkbox count.
- **Full notification set:** every notification is consequential (wallet or access changed). None are marketing. Skipping any of them creates a class of "silent fail" bug reports.

## Appendix B — Mapping to existing code

| Existing file | Change |
|---|---|
| [stores/reservationStore.ts](stores/reservationStore.ts) | Rewrite as server-state cache. `reserve()`, `cancel()`, `consume()` delegate to edge functions. Local 30-min cooldown and lock-minute constants move to `app_config`. |
| [stores/sessionStore.ts](stores/sessionStore.ts) | `startSession()` already auto-consumes a matching reservation. Update to call `reservation-consume` server-side instead of mutating local state. |
| [stores/paymentStore.ts](stores/paymentStore.ts) | Add `needsCardBeforeReserve()` mirror of `needsCardBeforeStart()`. |
| [lib/iyzico.ts](lib/iyzico.ts) | No changes — the existing `preauthorize` / `captureHold` / `releaseHold` are exactly the primitives needed. |
| [components/StationGateSelector.tsx](components/StationGateSelector.tsx) | Becomes a step in the reservation flow; emits `gate_id` to the slide deck or mini-confirm. |
| [app/reservations.tsx](app/reservations.tsx) | Refactor per §6.3. |
| [app/scan.tsx](app/scan.tsx) | Add reservation-consume call per §6.5. |
| [app/_layout.tsx](app/_layout.tsx) | Register `/reserve/[stationId]/[sport]/[gateId]` route. |
| [i18n/locales/tr.json](i18n/locales/tr.json), [en.json](i18n/locales/en.json) | Add reservation, lock, notification keys. |
| `supabase/functions/iyzico-*` | Add `reservation-create`, `reservation-cancel`, `reservation-consume`, `reservation-sweep`, `reservation-retry-capture`. |

---

## Appendix C — Implementation status (as of 2026-04-26)

13 commits on `feat/reservations` cover the design end-to-end. Two intentional v1 deferrals: per-gate UX and T-5 reminder push.

| Phase | Status | Commit prefix |
|---|---|---|
| 1. Schema migration (5 tables + RPC) | ✅ landed | `feat(reservations): phase 1` |
| 2. Core edge functions (create/cancel/consume) | ✅ landed | `phase 2` |
| 3. Sweep cron + retry-capture + lazy sweep | ✅ landed | `phase 3` |
| 4. Client lib wrapper + reactive state hook | ✅ landed | `phase 4` |
| 12. i18n keys (slides, errors, banners, notifs) | ✅ landed | `phase 12` |
| 5+6. Reserve flow (slides + mini-confirm) | ✅ landed | `phase 5+6` |
| 7. Reservations screen refactor | ✅ landed | `phase 7` |
| 8. Station gate selector handoff to /reserve | ✅ landed (gate_id synthesized as `${sport}-1`) | `phase 8` |
| 9. QR scan integration with consume | ✅ landed | `phase 9` |
| 10. Push notifications scaffold + sweep wiring | ✅ landed (3 of 5 events; T-5 reminder + force-release push wired separately) | `phase 10` |
| 11. Operator force-release endpoint | ✅ landed (with system-fault push) | `phase 11` |
| 13. QA checklist | ✅ this section | `phase 13` |

Known v1 limitations:
- Per-gate selection is auto-derived (`${sport}-1`); capacity is effectively 1 per (station, sport) until `stations.seed.ts` adds a `gates` field. The server already accepts arbitrary `gate_id` strings — the change is purely client-side.
- T-5 reminder is *not* yet scheduled — needs either a `pg_cron` at-time job per reservation or a `scheduled_pushes` table swept by the existing sweeper.
- Legacy [stores/reservationStore.ts](stores/reservationStore.ts) is still imported by some screens (map, play, station/[id], ActiveSessionBanner, sessionStore). Phase 7 + 8 migrated the screens that matter for the reserve loop; the rest will fall out as those callers are touched.
- expo-device is optional — install with `npx expo install expo-device` for richer push token device_info; without it the upsert stores nulls.

## Appendix D — Deployment runbook

### One-time setup
1. **Migrations** — apply in order:
   ```
   npx supabase db push
   ```
   This lands the four new migrations:
   - `20260426120000_reservations.sql` (5 tables + RPC)
   - `20260426130000_reservation_cron.sql` (pg_cron sweep job — see below for prereqs)
   - `20260426140000_push_tokens.sql` (push token storage)

2. **Vault secrets** for the pg_cron sweep job (Supabase Dashboard → Project Settings → Vault):
   - `sweep_url` → `https://<project-ref>.supabase.co/functions/v1/reservation-sweep`
   - `service_role_key` → from Project Settings → API

3. **Postgres extensions** (Dashboard → Database → Extensions):
   - Enable `pg_cron`
   - Enable `pg_net`

4. **Edge function env vars** (Dashboard → Edge Functions → Settings):
   - `SUPABASE_SERVICE_ROLE_KEY` (required by all reservation-* functions)
   - `IYZICO_API_KEY`, `IYZICO_SECRET_KEY`, `IYZICO_BASE_URL` (already set per existing iyzico-* functions)

5. **Deploy edge functions**:
   ```
   npx supabase functions deploy reservation-create
   npx supabase functions deploy reservation-cancel
   npx supabase functions deploy reservation-consume
   npx supabase functions deploy reservation-sweep
   npx supabase functions deploy reservation-retry-capture
   npx supabase functions deploy reservation-force-release
   ```

### QA test plan (run against the sandbox Iyzico account)

**Smoke — happy path:**
- [ ] Reserve from station screen → slide deck shows on first reservation only
- [ ] Tick agree, tap "rezerv et" → reservation row exists in DB, hold visible in Iyzico sandbox
- [ ] Reservations screen shows live countdown
- [ ] Within 2 min: cancel → status=`cancelled`, hold released, no penalty
- [ ] Reserve again → mini-confirm sheet (no slides this time)
- [ ] Walk to station → scan QR → consume → status=`consumed`, hold released
- [ ] Session starts as before (the existing session preauth replaces our hold)

**No-show path:**
- [ ] Reserve, do nothing for 30+ minutes
- [ ] pg_cron fires → row becomes `expired_captured`, ₺20 charged to sandbox card
- [ ] Push notification *"₺20 tahsil edildi"* lands
- [ ] Reservations screen shows -₺20 on the recent row

**Tier ladder:**
- [ ] Trigger 3 captures within 30 days (sandbox: shorten the windows in `app_config` to test in real time)
- [ ] On the 3rd capture: tier_24h lock applies, push *"rezervasyon kilidi"*, lock banner shows on reservations screen
- [ ] Try to reserve again → 403 `locked` error
- [ ] After 5 captures → tier_7d lock replaces tier_24h
- [ ] After 10 captures (or simulate via 90-day window) → manual_review lock with infinity expiry

**Payment-failed path:**
- [ ] Set Iyzico sandbox card to "decline on capture"
- [ ] Reserve, no-show → sweep tries capture, fails → status=`expired_captured` + payment_failed lock
- [ ] Reserve attempt → 403 `locked` reason=`payment_failed`
- [ ] Tap lock banner CTA → routes to /card-add
- [ ] Update card → call reservation-retry-capture → lock cleared

**Velocity caps:**
- [ ] Make 3 reservations in <1 hour (cancel each within grace) → 4th attempt → 429 `velocity_hour`
- [ ] Make 8 reservations in <24h → 9th attempt → 429 `velocity_day`

**Race + concurrency:**
- [ ] Two clients tap reserve on the same gate at the same instant
- [ ] One wins, one gets 409 `gate_taken_race`; the loser's preauth was rolled back via iyzico cancel

**System-fault path:**
- [ ] Hit `/functions/v1/reservation-force-release` with service-role JWT and a body `{ reservation_id, reason: "gate_jam" }`
- [ ] Row → `expired_released`, no charge, push *"sistemden kaynaklı bir sorun"* lands
- [ ] Tier counters NOT incremented (verify by checking captures count vs. before)

**Push notifications:**
- [ ] App granted notification permission → user_push_tokens row exists with valid expo_token
- [ ] Capture / capture-failure / tier-lock / system-fault all deliver to the device
- [ ] Permission denied → app still works; pushes are silently no-op'd

**Lazy sweep:**
- [ ] Disable pg_cron temporarily
- [ ] Let a reservation expire
- [ ] Open reservations screen → useReservationState's pre-fetch sweep captures the row in real time
