-- Adds t5_notified_at to reservations so the existing pg_cron sweeper
-- can also fire the "5 minutes left" push reminder.
--
-- The sweeper picks up two kinds of work in one query:
--   - active rows where now() >= expires_at  → capture the hold
--   - active rows where now() >= expires_at - 5min AND t5_notified_at is null
--                                            → send T-5 reminder push
-- Both flows share the existing iteration loop in reservation-sweep.

alter table public.reservations
  add column if not exists t5_notified_at timestamptz;

-- Fast path for "due for T-5 reminder" — rows that are still active and
-- haven't been notified yet, expiring in the near future.
create index if not exists reservations_t5_due
  on public.reservations(expires_at)
  where status = 'active' and t5_notified_at is null;
