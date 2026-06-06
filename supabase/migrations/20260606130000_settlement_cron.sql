-- SETTLEMENT CRON IS ENABLED. The integration blockers from the 2026-06-06 holistic
-- review are RESOLVED IN-CODE:
--   • consume now KEEPS the deposit hold LIVE (Fix A) — settlement no longer hits a dead
--     hold, so the per-minute capture/refund-of-a-void failure mode is gone.
--   • legacy reservation-sweep/-cancel/-force-release write `deposit_state` consistently
--     (Fix B), so new rows no longer desync from the settlement state machine.
--   • a consumed-never-opened reservation releases via session-sweep Pass 1c (Fix B),
--     so a hold that is consumed but never unlocked is not stranded as 'held'.
--   • cross-path double-capture is closed by the `deposit_state` terminal guard: once a
--     row is terminal, settlement returns 'none', so no second capture/refund can fire.
--
-- What REMAINS before production money is LIVE-VERIFICATION (not code blockers):
--   1. Confirm iyzico /payment/refund field names AND that the preauth (Auth) response
--      surfaces paymentTransactionId — it may be nested under itemTransactions[] — so
--      hold_txn_id actually populates at reservation-create time.
--   2. Run the iyzico-SANDBOX validation documented in
--      supabase/functions/settlement/_sim/README.md BEFORE pointing the function at
--      production.
--   3. Set IYZICO_* env (IYZICO_API_KEY / IYZICO_SECRET_KEY / IYZICO_BASE_URL) and the
--      `settlement_url` vault secret. The function fails SAFE via checkEnv() — an
--      unconfigured deploy is a no-op and won't move money.
-- The pure engine (decide.ts/process.ts) + its tests are correct and merge-safe.
--
-- Schedules the settlement Edge Function via pg_cron.
-- Mirrors 20260426130000_reservation_cron.sql + 20260605130000_session_sweep_cron.sql.
--
-- settlement CONSUMES the Phase 1 money-seam flags that reservation-sweep and
-- session-sweep only SET. Every minute it scans reservations whose deposit
-- (teminat, 20 TRY) is not yet terminal and a release/penalty/reversal flag is
-- set, and drives the right iyzico op (release / capture / refund) exactly once.
--
-- THE no-double-charge invariant (deposit_state flips ONLY after iyzico confirms
-- success; failures are retried next tick) lives in the pure core and is proven
-- by lib/server/settlement-process.test.ts. Re-running this cron on a terminal
-- row is a no-op (the decision returns 'none'), so frequent ticks are safe.
--
-- PRE-REQS (manual, one-time, via Supabase dashboard):
--   1. Project Settings → Database → Extensions: enable `pg_cron` and `pg_net`.
--      (Already enabled by 20260426130000_reservation_cron.sql; the
--       create extension if not exists below is idempotent.)
--   2. Vault (Project Settings → Vault) → add the secret (service_role_key is
--      reused from the reservation-sweep cron):
--        settlement_url      https://<project-ref>.supabase.co/functions/v1/settlement
--        service_role_key    eyJ...  (already added for reservation-sweep)
--   3. iyzico keys must be set on the project (IYZICO_API_KEY / IYZICO_SECRET_KEY /
--      IYZICO_BASE_URL) — the function responds safe (no-op) if they are missing.
--   4. Run this migration.
--
-- The cron job fires every minute (smallest pg_cron granularity). The
-- service-role JWT is read from Vault at job-run time so rotating the key takes
-- effect immediately, no migration needed.
--
-- To DISABLE the cron later:
--   select cron.unschedule('settlement');

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- make re-apply idempotent: drop any existing job of this name first
select cron.unschedule('settlement') where exists (select 1 from cron.job where jobname = 'settlement');

-- ENABLED. The unschedule guard above stays ACTIVE so re-applying this migration always
-- removes any stale 'settlement' job before (re)scheduling the one below.
select cron.schedule(
  'settlement',
  '* * * * *',
  $cmd$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'settlement_url' limit 1),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key' limit 1)
      ),
      body := '{}'::jsonb
    );
  $cmd$
);
