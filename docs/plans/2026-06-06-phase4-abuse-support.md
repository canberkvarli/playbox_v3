# Phase 4: Abuse / Support Tooling — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or subagent-driven-development) to implement this plan task-by-task.

**Goal:** Give operators the tools to resolve disputes ("I returned it but got charged"), issue refunds safely, see what physically happened, and watch station health — plus close the Phase 2 failing-candidate follow-up. All server-side, reusing the existing operator pattern; no new UI.

**Architecture:** Mirror the existing operator surface — SQL `SECURITY DEFINER` `op_*` functions (callable from Supabase Studio by ops) + service-role-guarded edge functions where iyzico/HTTP is involved. **Money safety is preserved by NOT letting support touch iyzico directly:** a dispute/refund op sets `reservation` flags (`disputed_at`, `reversal_eligible_at`), and the *audited, idempotent Phase 2 settlement worker* performs the actual release/refund. Marking a reservation **disputed pauses auto-settlement** so ops can adjudicate before money moves. Pure decision logic (dispute/quarantine guards, timeline merge) lives in Deno-free modules so Jest tests it.

**Tech stack:** Supabase (Postgres `SECURITY DEFINER` ops functions, Deno edge functions, `_shared/auth.ts` role check), the Phase 1 audit trail (`reservation_events` + `station_events`), the Phase 2 settlement engine (`decide.ts`/`process.ts` + `reversal_eligible_at` refund path), Jest for the pure modules.

---

## Grounding facts (verified)

- **Operator auth:** `_shared/auth.ts::getRoleFromRequest(req)` → must be `'service_role'` (see `reservation-force-release/index.ts:39-43`). SQL ops layer: `20260427120000_operator_functions.sql` — `op_find_user`, `op_recent_reservations`, `op_view_audit`, `op_force_release` (HTTP→edge w/ vault key), `op_clear_lock`. All `SECURITY DEFINER`, granted to `postgres`/`service_role` only. **Mirror this.**
- **Concurrency already enforced:** unique indexes `reservations_one_active_per_user` + `reservations_one_active_per_gate` (WHERE status='active'). Don't rebuild — but note Phase-1 `consumed` sessions aren't covered by these (status≠active); a user *could* hold a consumed session + a new active reservation. Decide if that needs a guard (likely fine — one consumed in-use + one reserved-ahead).
- **Locks:** `user_reservation_locks` (reasons `tier_24h|tier_7d|manual_review|payment_failed`, `locked_until` incl `infinity`), tier thresholds in `app_config`. `op_clear_lock` removes them.
- **Dispute timeline data:** join `reservations.ble_session_id == station_events.session_id`; merge with `reservation_events` (reservation_id) + the deposit columns. Everything needed to reconstruct "what physically happened + what money moved" exists.
- **Station health:** `stations` (battery_mv/pct, last_seen_at, acked_seq, last_event_seq, fw_version) + `station_events`.
- **Refund reuse:** Phase 2 `settlement` refunds when `reversal_eligible_at` set + `deposit_state='captured'`; releases when set + `held`. Support sets the flag; settlement does the money (audited, idempotent).
- **NO dispute status exists today** — greenfield. Photo-on-return / lost-gear is client-side + greenfield → **out of Phase 4 scope** (separate client feature).

---

## Task 1: Migration — dispute + settlement quarantine columns

**Files:** Create `supabase/migrations/20260606150000_dispute_quarantine.sql`

- `alter table reservations add column if not exists disputed_at timestamptz;` + `dispute_reason text;` + `disputed_by text;` (operator name). A non-null `disputed_at` = under review.
- Settlement quarantine (Phase 2 follow-up): `add column if not exists settle_attempts int not null default 0;` + `settle_last_error text;` + `quarantined_at timestamptz;` (a deposit that failed settlement too many times → parked for ops, stops retrying).
- Index: `create index if not exists reservations_settlement_attention_idx on reservations (id) where quarantined_at is not null or disputed_at is not null;` (the ops "needs attention" queue).
- Document: disputed_at pauses settlement; quarantined_at parks a permanently-failing deposit; both are cleared by ops resolution. Comment-document the settlement interaction. **Write-only; do not apply.** Read the real reservations schema first. Commit.

---

## Task 2: Settlement dispute + quarantine guards (pure + wire)

**Files:** `supabase/functions/settlement/process.ts` (extend) + `supabase/functions/settlement/guards.ts` (new pure) + `lib/server/settlement-guards.test.ts`; `supabase/functions/settlement/index.ts` (candidate query).

- **Pure `guards.ts`:**
  - `isSettlementBlocked({ disputed_at, quarantined_at })` → boolean (true if either set → settlement skips this row).
  - `shouldQuarantine(settleAttempts, maxAttempts)` → boolean (true when `settleAttempts >= maxAttempts`, default 5).
- **Wire into `process.ts`:** before deciding, if `isSettlementBlocked(candidate)` → `skipped++` (don't call decide/iyzico). On an iyzico FAILURE (the existing failure branch): increment `settle_attempts` (via a new `store.recordFailedAttempt(id, errorText)` port method), and if `shouldQuarantine(newAttempts, max)` → set `quarantined_at` + audit `deposit_quarantined`. (Preserves the hard contract: success path unchanged; this only adds attempt-tracking + parking on the failure path.) Return a `quarantined` count.
- **`index.ts` candidate query:** add `AND disputed_at IS NULL AND quarantined_at IS NULL` so blocked rows aren't even scanned (defense in depth) + read `maxAttempts` from `app_config` (`settle_max_attempts`, default 5).
- **Tests** (`lib/server/settlement-guards.test.ts` + extend the process test): disputed row → skipped, zero iyzico calls; quarantined row → skipped; a row that fails `maxAttempts` times → quarantined (one final attempt then parked, no more calls on re-run); a non-blocked row still settles. Run green.

Commit.

---

## Task 3: Dispute timeline (pure merge + ops function)

**Files:** `supabase/functions/_shared/disputeTimeline.ts` (pure) + `lib/server/dispute-timeline.test.ts`; SQL `op_dispute_timeline` in a migration `supabase/migrations/20260606160000_op_dispute_support.sql`.

- **Pure `buildDisputeTimeline(reservation, reservationEvents, stationEvents)`** → a single array of `{ at, source: 'reservation'|'station'|'deposit', kind, detail }` sorted by time. Merge: `reservation_events` (by `at`), `station_events` (by `received_at`/`wall_ts`, joined on `ble_session_id == session_id`), plus synthetic deposit milestones from the reservation columns (`opened_at`/`returned_at`/`*_eligible_at`/`settled_at`/`disputed_at`). Pure + total; stable sort; tolerate missing/unsorted input. This is the "what happened" record support reads to resolve a dispute.
- **Jest tests:** merges + sorts mixed events; joins station events by session id (ignores other sessions); injects deposit milestones; empty/partial input safe; the late-return story (gate_opened → abandoned → gate_closed → reversal) renders in order.
- **SQL `op_dispute_timeline(p_reservation_id uuid)`** (SECURITY DEFINER, service_role/postgres grant) returning the joined rows ordered by time (the DB-side equivalent ops run in Studio) — mirror `op_view_audit`'s style; this is the richer cross-source version.

Commit.

---

## Task 4: Operator support actions (dispute / refund / station health)

**Files:** extend `supabase/migrations/20260606160000_op_dispute_support.sql` with SECURITY DEFINER functions (mirror existing `op_*` grants/revokes):

- `op_mark_disputed(p_phone text, p_reservation_id uuid, p_reason text, p_admin text)` → set `disputed_at=now(), dispute_reason, disputed_by`; append `reservation_events` `disputed`. (Pauses settlement via Task 2.)
- `op_resolve_dispute(p_reservation_id uuid, p_action text, p_admin text)`:
  - `action='refund'`: set `reversal_eligible_at=now()` (settlement will refund-if-captured / release-if-held — the proven audited path), clear `disputed_at`, append `dispute_resolved{action:refund}`. **Does NOT call iyzico directly.**
  - `action='uphold'`: clear `disputed_at` (let the original settlement stand / resume), append `dispute_resolved{action:uphold}`.
  - Guard: only on a disputed row; idempotent.
- `op_unquarantine(p_reservation_id uuid, p_admin text)` → clear `quarantined_at` + reset `settle_attempts=0` so settlement retries (after ops fixed the underlying issue, e.g. a missing `hold_txn_id`); audit.
- `op_station_health()` → view/function over `stations` (battery_pct, last_seen_at, fw_version, seq drift `last_event_seq - acked_seq`) + a low-battery / stale-last-seen flag; the ops fleet view.
- `op_attention_queue()` → reservations where `disputed_at` or `quarantined_at` set (the "needs a human" list).

All revoke from public/authenticated; grant `postgres`/`service_role`. **Write-only** (Deno/SQL). Commit. Note: these are pure SQL state changes + flag-sets; the money is moved only by the already-tested settlement worker.

---

## Task 5: Integration gate — dispute & quarantine through settlement

**Files:** `lib/server/support-flow.test.ts` (Jest, reuse the Phase 2 recording-fake-iyzico harness).

Drive the pure `processSettlement` + guards across scenarios proving support actions are money-safe:
1. **Dispute pauses settlement:** a reservation with `penalty_eligible_at` set AND `disputed_at` set → settlement SKIPS it (zero iyzico calls) while disputed; clear `disputed_at` → next tick captures. (Proves marking disputed halts auto-money.)
2. **Resolve→refund:** a `captured` deposit, op sets `reversal_eligible_at` + clears dispute → settlement issues exactly ONE refund → `refunded`. (The "I returned it, give it back" flow, end-to-end through the proven path.)
3. **Resolve→uphold:** disputed `captured` row, uphold clears dispute, no `reversal` → settlement does nothing further (stays captured, money kept). Zero new iyzico calls.
4. **Quarantine:** a deposit whose iyzico op fails `settle_max_attempts` times → quarantined, settlement stops calling iyzico on it; `op_unquarantine` (simulated: clear quarantine + reset attempts) → retries once and succeeds. (Proves a stuck deposit can't spam forever and is recoverable.)
5. **Timeline correctness:** feed a realistic event set through `buildDisputeTimeline` → assert the ordered story support would read matches the actual sequence.

Green = support tooling is provably money-safe and reuses the audited settlement path. (Live: ops run the `op_*` functions in Studio; settlement cron does the money.)

Commit.

---

## Out of scope (later)
- **Photo-on-return / lost-gear** — client-side greenfield (a separate app feature, not server support tooling).
- **Rental usage fee** (still deferred from Phase 2).
- A graphical ops dashboard UI (these `op_*` functions are the backend it would call).
- Firmware Tasks 5–6 (hardware).

## Definition of done (Phase 4)
- Dispute columns + quarantine columns added; settlement SKIPS disputed/quarantined rows and PARKS deposits that fail `settle_max_attempts` times (pure-tested).
- Operator functions: mark/resolve dispute (refund via `reversal_eligible_at`, never direct iyzico), unquarantine, station-health, attention-queue — mirroring the existing `op_*` auth/grants.
- `buildDisputeTimeline` reconstructs one reservation's full physical+money story (pure-tested) + an `op_dispute_timeline` SQL function.
- **Money-safety preserved:** support sets flags; only the audited settlement worker moves money. Dispute pauses auto-settlement; resolve→refund flows through the proven path. Proven by the integration gate.
