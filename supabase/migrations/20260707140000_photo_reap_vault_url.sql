-- Ensures the Vault secrets the photo-reap cron needs actually exist, so the
-- job scheduled in 20260707130000_photo_reap_cron.sql can authenticate + reach
-- the Edge Function WITHOUT any manual dashboard step.
--
--   * service_role_key : must ALREADY exist (shared with the reservation/session
--     sweeps). We assert it and FAIL LOUDLY if it is missing, rather than ship a
--     silently-broken cron.
--   * photo_reap_url    : the function URL. Not sensitive (the project ref is
--     public), but kept in Vault for parity with the other sweep crons. Created
--     idempotently here so re-applying is a no-op.

-- 1) Hard assert the shared service-role key is present.
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'service_role_key') then
    raise exception
      'Vault secret "service_role_key" is missing — photo-reap cron cannot authenticate. Add it in Vault, then re-run.';
  end if;
end $$;

-- 2) Ensure photo_reap_url exists (create once; skip if already there).
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'photo_reap_url') then
    perform vault.create_secret(
      'https://ucyjbvajmrwermytyuik.supabase.co/functions/v1/photo-reap',
      'photo_reap_url',
      'photo-reap Edge Function URL for the pg_cron reaper'
    );
  end if;
end $$;
