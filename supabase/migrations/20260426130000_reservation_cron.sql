-- Schedules the reservation-sweep Edge Function via pg_cron.
--
-- PRE-REQS (manual, one-time, via Supabase dashboard):
--   1. Project Settings → Database → Extensions: enable `pg_cron` and `pg_net`.
--   2. Vault (Project Settings → Vault) → add two secrets:
--        sweep_url           https://<project-ref>.supabase.co/functions/v1/reservation-sweep
--        service_role_key    eyJ... (Project Settings → API → service_role key)
--   3. Run this migration.
--
-- The cron job fires every minute (smallest pg_cron granularity). The
-- service-role JWT is read from Vault at job-run time so rotating the
-- key takes effect immediately, no migration needed.
--
-- To DISABLE the cron later:
--   select cron.unschedule('reservation-sweep');

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'reservation-sweep',
  '* * * * *',
  $cmd$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'sweep_url' limit 1),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key' limit 1)
      ),
      body := '{}'::jsonb
    );
  $cmd$
);
