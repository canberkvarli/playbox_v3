-- Schedules the photo-reap Edge Function via pg_cron, and seeds the
-- return_photo_retention_days tunable. Mirrors 20260605130000_session_sweep_cron.sql.
--
-- photo-reap DELETES return/closing photos from the private `return-photos`
-- bucket once they are past the retention window AND no OPEN/REVIEWING
-- gear_report still references them (a live dispute keeps its evidence). It
-- KEEPS the gear_reports row (proof a report existed) and only NULLs photo_path.
-- This bounds storage growth and honours KVKK data-minimisation (personal images
-- are not kept longer than needed).
--
-- RETENTION IS A LEGAL DECISION, not a technical one. 30 days is a generous
-- dispute/complaint window; adjust `return_photo_retention_days` to whatever your
-- KVKK / distance-contract retention policy requires. No migration needed to
-- change it — update the app_config row and the next daily run picks it up.
--
-- PRE-REQS (manual, one-time, via Supabase dashboard):
--   1. Project Settings -> Database -> Extensions: enable `pg_cron` and `pg_net`.
--      (Already enabled by earlier cron migrations; the create-if-not-exists
--       below is idempotent.)
--   2. Vault (Project Settings -> Vault) -> add the secret (service_role_key is
--      reused from the existing sweeps):
--        photo_reap_url    https://<project-ref>.supabase.co/functions/v1/photo-reap
--        service_role_key  eyJ...  (already added for reservation/session sweep)
--   3. Deploy the function:  supabase functions deploy photo-reap
--   4. Run this migration.
--
-- The job fires ONCE DAILY at 03:17 UTC (photos are not time-critical; a daily
-- reap is plenty and keeps load off the every-minute sweeps). The service-role
-- JWT is read from Vault at run time so rotating the key takes effect immediately.
--
-- To DISABLE the cron later:
--   select cron.unschedule('photo-reap');

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Tunable: how many days a return photo is retained before it is reaped.
-- jsonb value to match the app_config seed convention (see 20260605130000).
insert into public.app_config (key, value) values
  ('return_photo_retention_days', '30'::jsonb)
on conflict (key) do nothing;

-- make re-apply idempotent: drop any existing job of this name first
select cron.unschedule('photo-reap') where exists (select 1 from cron.job where jobname = 'photo-reap');

select cron.schedule(
  'photo-reap',
  '17 3 * * *',
  $cmd$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'photo_reap_url' limit 1),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key' limit 1)
      ),
      body := '{}'::jsonb
    );
  $cmd$
);
