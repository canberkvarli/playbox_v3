-- Deposit settlement v1
-- Phase 2, Task 1: the deposit (teminat, 20 TRY safety deposit) state machine.
--
-- Phase 1 (20260605120000_stations_and_events.sql) only SET money-seam flags on
-- reservations and never moved money:
--   reversal_eligible_at  => a penalty may have been captured; REFUND it. Wins over penalty.
--   penalty_eligible_at   => capture the safety deposit/penalty. Cleared on late return.
--   release_eligible_at   => baseline: release the hold (on-time/confirmed return or void).
--
-- Phase 2 CONSUMES those flags via iyzico. This migration adds the deposit
-- state machine columns the settlement worker (Task 3+) drives. It only adds
-- columns/indexes and backfills already-terminal rows; it moves no money.
--
-- ┌─────────────────────────────────────────────────────────────────────────┐
-- │ deposit_state machine                                                     │
-- │                                                                           │
-- │   held  ── preauth placed (reservation create) ──> initial state          │
-- │     │                                                                     │
-- │     ├─ release_eligible_at  ──> released   (iyzico void / cancel preauth) │
-- │     ├─ penalty_eligible_at  ──> captured   (iyzico capture the deposit)   │
-- │     └─ reversal_eligible_at ──> refunded   (iyzico refund a prior capture │
-- │                                             if captured, else release)    │
-- │                                                                           │
-- │   Terminal states: released | captured | refunded                         │
-- └─────────────────────────────────────────────────────────────────────────┘
--
-- SETTLEMENT PRECEDENCE (highest wins — mirrors the Phase 1 comment):
--   1. reversal_eligible_at  -> if currently captured: REFUND -> 'refunded'
--                               else (still held):      RELEASE -> 'released'
--   2. penalty_eligible_at   -> CAPTURE the deposit            -> 'captured'
--   3. release_eligible_at   -> RELEASE the hold               -> 'released'
-- A returned ball is NEVER net-penalized: a late return sets reversal_eligible_at
-- (and Phase 1 clears penalty_eligible_at), so reversal always overrides penalty.
--
-- All writes happen via Edge Functions running as the service role; clients
-- never touch these columns directly (reservations RLS is already read-only-owner).

------------------------------------------------------------
-- deposit_state: the settlement state machine column
------------------------------------------------------------
alter table public.reservations
  add column if not exists deposit_state text not null default 'held';

comment on column public.reservations.deposit_state is
  'Deposit (teminat, 20 TRY) settlement state machine. '
  'held (after preauth) -> terminal released | captured | refunded. '
  'Settlement precedence (highest wins): '
  'reversal_eligible_at -> refund-if-captured-else-release; '
  'penalty_eligible_at -> capture; '
  'release_eligible_at -> release. '
  'A returned ball is NEVER net-penalized (reversal overrides penalty).';

-- when the deposit reached a terminal state (settlement completed)
alter table public.reservations
  add column if not exists settled_at timestamptz;

comment on column public.reservations.settled_at is
  'Timestamp the deposit reached a terminal deposit_state (settlement completed).';

-- iyzico paymentTransactionId, captured from the preauth response
alter table public.reservations
  add column if not exists hold_txn_id text;

comment on column public.reservations.hold_txn_id is
  'iyzico paymentTransactionId from the preauth (Auth) response. Distinct from '
  'reservations.hold_id (the iyzico paymentId). Needed because /payment/refund '
  'keys on paymentTransactionId, not paymentId. Persisted at reservation-create '
  'time (Task 2).';

------------------------------------------------------------
-- Settlement scan index: rows settlement might still act on.
-- Either still held (any flag may fire), or captured AND a reversal became
-- eligible (late return after a penalty capture -> refund pending).
-- Terminal rows with no pending reversal are excluded to keep the scan cheap.
------------------------------------------------------------
create index if not exists reservations_settlement_idx
  on public.reservations (id)
  where deposit_state = 'held'
     or (reversal_eligible_at is not null and deposit_state = 'captured');

------------------------------------------------------------
-- Backfill: stamp deposit_state on rows that pre-date this column so the
-- settlement worker never re-settles an already-terminal reservation.
--
-- Mapping from the existing reservation_status enum
-- (active | consumed | cancelled | expired_captured | expired_released):
--   expired_captured -> 'captured'  (hold was captured on expiry)
--   expired_released -> 'released'  (hold was released on expiry)
--   cancelled        -> 'released'  (cancel voids/releases the preauth hold)
--   consumed         -> 'released'  (ASSUMPTION: consuming a reservation already
--                                    released the initial deposit hold — verify
--                                    before live apply, see report)
--   active / anything else        -> left as the 'held' default
--
-- Guarded by `deposit_state = 'held'` so this is idempotent and safe to re-run:
-- it only ever rewrites the freshly-added default, never an already-settled row.
------------------------------------------------------------
update public.reservations
set deposit_state = case status
    when 'expired_captured' then 'captured'
    when 'expired_released' then 'released'
    when 'cancelled'        then 'released'
    when 'consumed'         then 'released'
    else deposit_state
  end
where deposit_state = 'held'
  and status in ('expired_captured', 'expired_released', 'cancelled', 'consumed');
