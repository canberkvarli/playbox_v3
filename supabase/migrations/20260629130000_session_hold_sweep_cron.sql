-- Schedules the session-hold-sweep Edge Function via pg_cron.
-- Mirrors 20260606130000_settlement_cron.sql.
--
-- session-hold-sweep RELEASES orphaned Path-B (session-prep) iyzico pre-auth
-- holds: rows in `session_holds` left in state='held' past the TTL because the
-- client never captured/released them (app killed mid-session, silent fetch
-- failure). Every minute it scans still-held rows older than the TTL and voids
-- the hold via iyzico /payment/cancel, freeing the user's card.
--
-- RELEASE ONLY — it never captures. So the failure mode of a misfire is "a user
-- got their deposit back early," not an over-charge. The function ALSO fails
-- safe: checkEnv() makes an iyzico-unconfigured deploy a no-op.
--
-- PRE-REQS (manual, one-time, via Supabase dashboard):
--   1. Extensions pg_cron + pg_net enabled (already enabled by the reservation
--      cron; the create-extension-if-not-exists below is idempotent).
--   2. Deploy the function:
--        supabase functions deploy session-hold-sweep
--   3. Vault (Project Settings → Vault) → add the secret (service_role_key is
--      reused from the existing sweeps):
--        session_hold_sweep_url   https://<project-ref>.supabase.co/functions/v1/session-hold-sweep
--        service_role_key         eyJ...  (already added for reservation-sweep)
--   4. iyzico keys set on the project (IYZICO_API_KEY / IYZICO_SECRET_KEY /
--      IYZICO_BASE_URL). VERIFY iyzico /payment/cancel in SANDBOX first — the
--      function responds safe (no-op) until these are set.
--   5. Run this migration.
--
-- To DISABLE later:
--   select cron.unschedule('session-hold-sweep');

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- make re-apply idempotent: drop any existing job of this name first
select cron.unschedule('session-hold-sweep')
where exists (select 1 from cron.job where jobname = 'session-hold-sweep');

select cron.schedule(
  'session-hold-sweep',
  '* * * * *',
  $cmd$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'session_hold_sweep_url' limit 1),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key' limit 1)
      ),
      body := '{}'::jsonb
    );
  $cmd$
);
