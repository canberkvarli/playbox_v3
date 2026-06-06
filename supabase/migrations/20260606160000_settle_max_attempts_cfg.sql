-- Seeds the `settle_max_attempts` app_config tunable.
--
-- Phase 4, Task 2: caps how many times the settlement worker retries a deposit
-- before parking it. After this many FAILED iyzico settlement attempts
-- (ok:false / throw), the worker quarantines the reservation (sets
-- quarantined_at) instead of retrying it forever — closing the permanently-
-- failing-candidate hole (e.g. a deleted iyzico payment ref) from Phase 2.
--
-- The settlement worker (settlement/index.ts) reads this on each run and passes
-- it to the pure core as deps.maxAttempts; shouldQuarantine(settle_attempts,
-- maxAttempts) parks the row at the boundary. Matches the index.ts default
-- (DEFAULT_SETTLE_MAX_ATTEMPTS = 5). jsonb value to match the existing
-- app_config seed convention in 20260426120000_reservations.sql.

insert into public.app_config (key, value) values
  ('settle_max_attempts', '5'::jsonb)
on conflict (key) do nothing;
