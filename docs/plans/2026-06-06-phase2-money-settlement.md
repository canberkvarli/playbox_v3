# Phase 2: Money Settlement (deposit/penalty) — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or subagent-driven-development) to implement this plan task-by-task.

**Goal:** Consume the Phase 1 money-seam flags (`release_eligible_at` / `penalty_eligible_at` / `reversal_eligible_at`) and actually move the money via iyzico — release the safety deposit on a confirmed return, capture it as a penalty on abandonment, and refund it on a late return after capture. **Scope: the existing safety deposit (teminat) only.** The rental usage fee is a separate later phase.

**Architecture:** A new `settlement` Supabase edge function (pg_cron, every minute) scans reservations that have a settlement flag set but a deposit not yet at its terminal state, and drives the iyzico op idempotently. The decision is a PURE function `decideDepositSettlement(flags, depositState)` (precedence **reversal > penalty > release**) so it's fully Jest-testable; the iyzico I/O is injected behind a port so the orchestration is testable with a recording fake (proving no double-charge) without hitting iyzico. Money is settled in this dedicated, auditable step — reconciliation (Phase 1) only ever set the flags.

**Tech stack:** Supabase (Postgres + Deno edge functions), `_shared/iyzico.ts` (IYZWSv2: `preauth`/`postauth`(capture)/`cancel`(release) + NEW `refund`), the Phase 1 reservation seam columns, `reservation-sweep` cron pattern, Jest for the pure decision + orchestration.

---

## Grounding facts (verified)

- **iyzico helpers** (`supabase/functions/_shared/iyzico.ts`): `preauth(req)`→`/payment/preauth` returns `paymentId` + `paymentTransactionId`; `postauth(req)`→`/payment/postauth` (capture, takes `paymentId`); `cancel(req)`→`/payment/cancel` (release a not-yet-captured hold, takes `paymentId`). **No refund yet.** All take a `conversationId` (iyzico-side idempotency/dedup) and `ip`. `checkEnv()` guards missing keys.
- **Today's deposit lifecycle:** `reservation-create` `preauth` → stores `paymentId` in `reservations.hold_id`; `reservation-consume`/`reservation-cancel`(grace) `cancel`; `reservation-sweep`/`reservation-cancel`(after-grace) `postauth`. Amount `cfg.reservation_hold_try = 20` TRY. Idempotency = status guard (`status='active'`) + `conversationId` like `sweep:${r.id}`.
- **Phase 1 seam** (`20260605120000_stations_and_events.sql`): `reservations.release_eligible_at | penalty_eligible_at | reversal_eligible_at` are SET by `ingest-events`/`session-sweep` and **consumed by nothing yet**. Documented precedence: `reversal_eligible_at` cancels penalty; `release_eligible_at` is baseline. `gate_closed` already CLEARS `penalty_eligible_at` on a late return and sets `reversal_eligible_at`.
- **iyzico refund:** `/payment/refund` refunds a captured transaction; it keys on `paymentTransactionId` (+ `price`, `ip`, `currency`), NOT `paymentId`. So we must persist the preauth's `paymentTransactionId` to refund later.

---

## The deposit state machine (the contract)

Add `reservations.deposit_state`: `held` (default, after preauth) → terminal `released | captured | refunded`.

`decideDepositSettlement({ release_eligible_at, penalty_eligible_at, reversal_eligible_at, deposit_state })` → `{ action: 'release' | 'capture' | 'refund' | 'none'; nextState }`:

| Flags (precedence top-down) | deposit_state | action | nextState |
|---|---|---|---|
| `reversal_eligible_at` set | `captured` | **refund** (give back a captured penalty) | `refunded` |
| `reversal_eligible_at` set | `held` (penalty never captured — return beat the sweep) | **release** (cancel the hold) | `released` |
| `reversal_eligible_at` set | `released`/`refunded` | none (idempotent) | unchanged |
| `penalty_eligible_at` set (no reversal) | `held` | **capture** | `captured` |
| `penalty_eligible_at` set (no reversal) | `captured` | none | unchanged |
| `release_eligible_at` set (no penalty/reversal) | `held` | **release** (cancel) | `released` |
| `release_eligible_at` set | `released` | none | unchanged |
| no flags / state already terminal-correct | * | none | unchanged |

Invariant: **a returned ball is never net-penalized** — reversal always wins and either refunds (if captured) or releases (if still held). Idempotent: an op only fires when the current `deposit_state` is the actionable precursor; terminal states are no-ops. Each op uses `conversationId = settle:${reservation_id}:${action}` for iyzico-side dedup.

---

## Task 1: Migration — deposit state + refund txn id

**Files:** Create `supabase/migrations/20260606120000_deposit_settlement.sql`

- `alter table reservations add column if not exists deposit_state text not null default 'held';` (values held|released|captured|refunded; document the state machine + precedence in a comment).
- `add column if not exists settled_at timestamptz;`
- `add column if not exists hold_txn_id text;` (the preauth `paymentTransactionId`, needed for refund).
- Partial index for the settlement scan: `create index if not exists reservations_settlement_idx on reservations (id) where deposit_state = 'held' or (reversal_eligible_at is not null and deposit_state = 'captured');` (the rows settlement may still need to act on).
- Backfill: existing terminal reservations — set `deposit_state` from `status` where unambiguous (`expired_captured`→`captured`, `expired_released`/`cancelled`→`released`, `consumed`→`released` since consume already released the initial hold), else leave `held`. Document assumptions to verify.

**Do NOT apply to any DB** (write-only; live apply deferred, same as Phase 1). Read the real `reservations` schema first to match types. Commit.

---

## Task 2: iyzico `refund` helper + persist `paymentTransactionId`

**Files:** `supabase/functions/_shared/iyzico.ts`; `supabase/functions/reservation-create/index.ts` (persist txn id).

- Add `RefundRequest = { locale; conversationId; paymentTransactionId; price; ip; currency:'TRY' }`, `RefundResponse = IyzicoBase & { paymentId?; paymentTransactionId? }`, and `export function refund(req)` → `iyzicoPost('/payment/refund', req)`, mirroring `cancel`/`postauth`. (Confirm the exact field names against iyzico docs in a comment; `paymentTransactionId` + `price` is the documented refund key.)
- In `reservation-create`, when storing `hold_id` from the preauth response, ALSO persist `paymentTransactionId` into the new `reservations.hold_txn_id` (best-effort; refund degrades gracefully if absent — log + skip).
- Tests: iyzico helpers do live HMAC/HTTP, so unit-test only what's pure. If the request-builder isn't separable, add at minimum a type-level/shape test that `refund` posts to `/payment/refund` with the expected body keys via a stubbed `iyzicoPost` (or skip if not cleanly stubbable and rely on the orchestration test in Task 4). Commit.

---

## Task 3: pure `decideDepositSettlement` (the precedence engine)

**Files:** Create `supabase/functions/settlement/decide.ts` (Deno-free, Jest-importable) + `lib/server/settlement-decide.test.ts`.

- Implement the table above exactly. Input the three `*_eligible_at` (as `string | null`) + `deposit_state`. Output `{ action, nextState, reason }`. Pure + total.
- Jest tests (`lib/server/settlement-decide.test.ts`, importing from `../../supabase/functions/settlement/decide`): every row of the table, INCLUDING: reversal+captured→refund; reversal+held→release; penalty+held→capture; penalty+captured→none (idempotent); release+held→release; release+released→none; all-flags-null→none; reversal beats a co-set penalty (returned ball never penalized); already-terminal→none. Red→green. Commit.

---

## Task 4: `settlement` edge function (pure orchestration + thin Deno shell + cron)

**Files:** `supabase/functions/settlement/process.ts` (pure, over a port) + `lib/server/settlement-process.test.ts`; `supabase/functions/settlement/index.ts` (Deno shell); `supabase/migrations/20260606130000_settlement_cron.sql`.

- **Pure `processSettlement(deps, opts)`** — Deno-free. `deps = { getCandidates, iyzico: { capture, release, refund }, markSettled, appendReservationEvent, now, ip, amountTry }`. For each candidate reservation: `decideDepositSettlement(...)`; if `action==='none'` skip; else call the matching iyzico op (`capture`/`release`/`refund`) with `conversationId = settle:${id}:${action}`; on iyzico `status==='success'` → `markSettled(id, nextState, now)` + `appendReservationEvent(id, 'deposit_'+action, {...})`; on failure → leave state unchanged (retried next tick), append a `deposit_settle_failed` audit, continue (per-row best-effort, one failure never blocks others). Return counts `{ released, captured, refunded, failed, skipped }`. NO double-charge: the `deposit_state` guard in `decide` + the terminal `nextState` write make a re-run a no-op.
- **Jest `lib/server/settlement-process.test.ts`** with an in-memory candidate store + a RECORDING fake iyzico (records calls, returns success/failure on demand): happy release/capture/refund; idempotent re-run → zero new iyzico calls; reversal+captured→exactly one refund; iyzico failure → state unchanged + retried succeeds next run; precedence (penalty+reversal both set → refund, never capture); per-row isolation (one failure doesn't block the rest). This is the **no-double-charge proof**.
- **Deno `index.ts`**: service-role + cron-guard like `reservation-sweep`; `checkEnv()` (fail safe if iyzico keys missing); build `deps` from supabase + the real iyzico helpers; read deposit amount from `app_config` (`reservation_hold_try`, default 20); call `processSettlement`; respond counts. NO money logic inline — all in the pure core.
- **Cron migration** `20260606130000_settlement_cron.sql`: schedule `settlement` every minute (mirror `reservation-sweep` cron + the idempotent `cron.unschedule` guard from Phase 1 Task 5). Commit each step.

---

## Task 5: settlement simulator / integration test (the gate)

**Files:** `lib/server/settlement-loop.test.ts` (Jest) + a short note in a `_sim` README for the live run.

Drive `processSettlement` end-to-end through scenarios with seeded reservations + a recording fake iyzico, asserting the FULL deposit lifecycle and money-safety:
1. Confirmed return: `release_eligible_at` set, `held` → one `cancel`, `deposit_state=released`, audit `deposit_release`.
2. Abandoned: `penalty_eligible_at` set, `held` → one `postauth` capture, `captured`.
3. Late return after penalty: penalty captured, then `reversal_eligible_at` set → one `refund`, `refunded`; `penalty_eligible_at` already cleared by Phase 1 — assert no capture.
4. Return beat the sweep: `reversal_eligible_at` + `held` (never captured) → `cancel` release, no refund.
5. Idempotency: re-run every scenario → zero additional iyzico calls, states unchanged.
6. iyzico failure: capture returns `failure` → state stays `held`, audited; next run with success → captures once.
7. Money-safety invariant: a reservation with BOTH penalty and reversal set is only ever refunded/released, never net-charged.

Green = the deposit settlement is provably correct + idempotent before any real iyzico call. **Live gate (deferred):** with the migrations applied + iyzico sandbox keys set, run `settlement` against seeded reservations and confirm real sandbox release/capture/refund.

---

## Out of scope (later)
- **Rental usage fee** (per-use charge separate from the deposit) — needs a pricing model; future phase.
- Concurrency hardening: settlement cron vs a manual settle racing the same row → guard with `FOR UPDATE SKIP LOCKED` or a `settling_at` claim (same class as Phase 1's audit-concurrency follow-up). Document; low risk at one-run/min + terminal-state guard.
- App-side UX for "deposit released/charged/refunded" messaging.

## Definition of done (Phase 2)
- Migration adds `deposit_state`/`settled_at`/`hold_txn_id`; `refund` helper added; `paymentTransactionId` persisted at preauth.
- `decideDepositSettlement` implements the precedence table, fully Jest-tested.
- `settlement` function settles eligible reservations idempotently, best-effort, no double-charge; pure core + orchestration Jest-tested with a recording fake iyzico (the no-double-charge proof); cron scheduled.
- **Money-safety invariant holds: a returned ball is never net-penalized** (reversal always refunds/releases).

---

## ⚠️ Phase 2 go-live blockers (from holistic review)

A holistic review (2026-06-06) confirmed the pure engine (`decide.ts`/`process.ts`) and the migrations are **correct and merge-safe**, but found that the settlement integrates onto a broken money-model assumption. The settlement cron is therefore **DISABLED** in `supabase/migrations/20260606130000_settlement_cron.sql` (the `cron.schedule(...)` call is commented out; the idempotent `cron.unschedule(...)` guard stays active). It must NOT be enabled until the blockers below are resolved and verified.

- **CRITICAL #1 — deposit hold voided at consume:** `reservation-consume` calls `iyzicoRelease`/`cancel` on `hold_id` at QR-scan, so **no live hold exists** by the time `session-sweep`/`gate_closed` set the `*_eligible_at` flags. With the hold already voided, settlement can't actually collect the abandonment penalty (capture) or refund it — it would just fail every minute against a dead hold. The abandonment penalty cannot collect money as-is. **Resolution options (needs a PRODUCT/ARCH decision):** (a) `consume` keeps the hold live through the session; (b) place a NEW in-session hold at unlock and record it as the settlement target; (c) move the penalty onto a separate instrument.

- **CRITICAL #3 — legacy `deposit_state` desync:** the legacy money flows (`reservation-sweep`/`-consume`/`-cancel`/`-force-release`) don't write `reservation.deposit_state`. They MUST going forward (not just the one-time backfill in the Task 1 migration), otherwise settlement will read a stale `held` state and act on a hold that legacy code has already captured/released → double-move. Required writes: sweep→`captured`, consume→`released`, cancel→`released`/`captured`, force-release→`released`.

- **IMPORTANT #4 — cross-path `conversationId` (no iyzico dedupe):** legacy ops use `conversationId` like `sweep:…`/`cancel:…`/`consume:…` while settlement uses `settle:${id}:${action}`. Because the prefixes differ, iyzico will NOT dedupe a legacy-vs-settlement double-capture of the same hold. Cross-path safety currently rests only on (unenforced) status/hold disjointness between the legacy path and the settlement path — there is no hard guard.

- **MINORS:**
  - Verify iyzico `/payment/refund` field names (`paymentTransactionId` + `price`) against current v2 docs.
  - `hold_txn_id` is persisted best-effort at preauth; an absent value must surface to an operator (not silently skip the refund).
  - Multi-worker safety: a settlement scan needs `FOR UPDATE SKIP LOCKED` (or a `settling_at` claim) before it can safely run with more than one worker.
  - Add a failing-candidate alert/backoff (max attempts) so a permanently-failing (e.g. dead-hold) row can't spam `reservation_events` every minute.

**Status:** The settlement cron is DISABLED pending the above; the pure engine + all migrations are merge-safe and the Jest suite stays green. Re-enable only by uncommenting the `cron.schedule(...)` after every blocker is resolved and verified.
