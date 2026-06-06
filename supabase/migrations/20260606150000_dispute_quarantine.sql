-- Disputes + settlement quarantine
-- Phase 4, Task 1: operator/support tooling + abuse hardening.
--
-- Adds two independent "pause settlement" mechanisms as columns on reservations:
--
--   (a) DISPUTE — `disputed_at` (non-null) marks a reservation as under operator
--       review. While set, the settlement worker (Task 2) SKIPS the row: money is
--       frozen until ops adjudicate. Resolution (op_resolve_dispute, Task 4) either
--       sets reversal_eligible_at to REFUND the rider, OR clears disputed_at to
--       UPHOLD the existing settlement precedence (penalty/release). `dispute_reason`
--       and `disputed_by` capture why it was flagged and which operator flagged it.
--
--   (b) QUARANTINE — `quarantined_at` (non-null) parks a deposit that has failed
--       settlement too many times (the Phase 2 failing-candidate follow-up). Without
--       this, a permanently-failing deposit (e.g. a deleted iyzico payment ref) would
--       be retried by the worker forever. Once quarantined, the settlement worker
--       (Task 2) SKIPS the row until ops clears it (op function, Task 4).
--       `settle_attempts` counts failed settlement attempts; `settle_last_error`
--       records the most recent failure reason (e.g. missing_payment_ref /
--       iyzico_not_ok) so ops can triage without digging through logs.
--
-- Settlement-worker contract (Task 2 will enforce): the candidate query gains
--   AND disputed_at IS NULL AND quarantined_at IS NULL
-- so neither disputed nor quarantined rows are ever auto-settled. Both flags are
-- cleared only by the operator functions in Task 4.
--
-- Columns only / indexes only — moves no money, mutates no existing rows. All
-- writes happen via Edge Functions running as the service role; clients never
-- touch these columns directly (reservations RLS is already read-only-owner).

------------------------------------------------------------
-- Dispute columns: non-null disputed_at pauses auto-settlement.
------------------------------------------------------------
alter table public.reservations
  add column if not exists disputed_at timestamptz;

comment on column public.reservations.disputed_at is
  'Non-null => reservation is under operator review; the settlement worker SKIPS '
  'it (deposit frozen). Resolved by op_resolve_dispute (Phase 4 Task 4): either '
  'sets reversal_eligible_at for a refund, or clears disputed_at to uphold the '
  'existing settlement precedence (penalty/release).';

alter table public.reservations
  add column if not exists dispute_reason text;

comment on column public.reservations.dispute_reason is
  'Free-text reason the reservation was flagged for dispute (operator-supplied).';

alter table public.reservations
  add column if not exists disputed_by text;

comment on column public.reservations.disputed_by is
  'Operator name/id who flagged this reservation for dispute.';

------------------------------------------------------------
-- Settlement quarantine columns: a permanently-failing deposit is parked for
-- ops instead of being retried forever.
------------------------------------------------------------
alter table public.reservations
  add column if not exists settle_attempts int not null default 0;

comment on column public.reservations.settle_attempts is
  'Count of failed settlement attempts for this deposit. Incremented by the '
  'settlement worker (Task 2) on each failure; drives the quarantine threshold.';

alter table public.reservations
  add column if not exists settle_last_error text;

comment on column public.reservations.settle_last_error is
  'Most recent settlement failure reason (e.g. missing_payment_ref / iyzico_not_ok). '
  'Recorded by the settlement worker so ops can triage without reading logs.';

alter table public.reservations
  add column if not exists quarantined_at timestamptz;

comment on column public.reservations.quarantined_at is
  'Non-null => deposit parked after too many failed settlement attempts; the '
  'settlement worker SKIPS it (stops retrying) until ops clears it (Phase 4 Task 4). '
  'See settle_attempts / settle_last_error for why.';

------------------------------------------------------------
-- Ops "needs attention" index: cheaply find rows an operator must act on
-- (quarantined or disputed). Partial so it only covers the handful of parked /
-- flagged rows, not the whole table.
------------------------------------------------------------
create index if not exists reservations_settlement_attention_idx
  on public.reservations (id)
  where quarantined_at is not null or disputed_at is not null;
