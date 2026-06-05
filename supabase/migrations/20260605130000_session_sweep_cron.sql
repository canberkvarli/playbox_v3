-- Schedules the session-sweep Edge Function via pg_cron, and seeds the
-- max_session_in_use_min tunable. Mirrors 20260426130000_reservation_cron.sql.
--
-- session-sweep COMPLEMENTS reservation-sweep (it does NOT replace it):
--   - reservation-sweep captures reservations that EXPIRE before being consumed.
--   - session-sweep (Pass 1) flags reservations that were physically OPENED but
--     never RETURNED and are now past max_session_in_use_min => penalty_eligible_at
--     (NO money capture — Phase 2 does that), and (Pass 2) drains any
--     station_events left with reconciled_at IS NULL for stations gone quiet.
--
-- PRE-REQS (manual, one-time, via Supabase dashboard):
--   1. Project Settings → Database → Extensions: enable `pg_cron` and `pg_net`.
--      (Already enabled by 20260426130000_reservation_cron.sql; the
--       create extension if not exists below is idempotent.)
--   2. Vault (Project Settings → Vault) → add the secret (service_role_key is
--      reused from the reservation-sweep cron):
--        session_sweep_url   https://<project-ref>.supabase.co/functions/v1/session-sweep
--        service_role_key    eyJ...  (already added for reservation-sweep)
--   3. Run this migration.
--
-- The cron job fires every minute (smallest pg_cron granularity). The
-- service-role JWT is read from Vault at job-run time so rotating the key takes
-- effect immediately, no migration needed.
--
-- To DISABLE the cron later:
--   select cron.unschedule('session-sweep');

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Tunable: max minutes a session may be physically in use (opened, not returned)
-- before it is flagged abandoned. Matches the index.ts default (90). jsonb value
-- to match the existing app_config seed convention in 20260426120000.
insert into public.app_config (key, value) values
  ('max_session_in_use_min', '90'::jsonb)
on conflict (key) do nothing;

select cron.schedule(
  'session-sweep',
  '* * * * *',
  $cmd$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'session_sweep_url' limit 1),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key' limit 1)
      ),
      body := '{}'::jsonb
    );
  $cmd$
);
