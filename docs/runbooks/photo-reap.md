# Short-lived return photos — deploy runbook

> **STATUS: DEPLOYED to production (`ucyjbvajmrwermytyuik`) on 2026-07-07.**
> Function live, migrations applied, cron scheduled, Vault secrets in place.
> Verified: service-role call → `200 {"ok":true,...}`; anon call → `401`.
> The client-side photo shrink activates on the **next native build** (no-op over OTA).

Keeps the private `return-photos` bucket small and KVKK-compliant. Two layers:

1. **Shrink on capture** (ships with the app) — `compressReturnPhoto` resizes to
   1600px wide @ JPEG 0.5 before upload (~10× smaller). Best-effort; falls back
   to the raw capture if the native module isn't in the running binary.
2. **Reap on a schedule** (this runbook) — the `photo-reap` Edge Function, run
   daily by pg_cron, DELETES photos older than the retention window **unless** an
   `open`/`reviewing` gear_report still references them (live dispute = keep the
   evidence). The `gear_reports` row is always kept; only `photo_path` is nulled.

## Retention window — YOUR legal call

Default **30 days** (`app_config.return_photo_retention_days`). This is a
KVKK / distance-contract decision, not a technical one. Change it any time with
no redeploy:

```sql
update public.app_config
set value = '45'::jsonb            -- days
where key = 'return_photo_retention_days';
```

The next daily run picks it up.

## How it was deployed (reproduce for the next env)

No dashboard clicks needed — the Vault `photo_reap_url` secret is created by a
migration (`vault.create_secret`, guarded), and `service_role_key` is reused from
the existing sweeps (a migration asserts it exists and fails loudly if not).

```bash
export PATH="/opt/homebrew/bin:$PATH"
supabase migration list --linked        # confirm only the new migrations are pending
supabase functions deploy photo-reap    # bundles via Docker edge-runtime
supabase db push                         # applies: cron, vault-url, reapable RPC
```

Migrations applied (in order):
- `20260707130000_photo_reap_cron.sql` — seeds `return_photo_retention_days=30`, schedules the daily 03:17 UTC job.
- `20260707140000_photo_reap_vault_url.sql` — asserts `service_role_key`, creates `photo_reap_url` in Vault.
- `20260707150000_reapable_photos_rpc.sql` — `SECURITY DEFINER` RPC to read `storage.objects` (that schema isn't exposed to PostgREST).

## Verify

```bash
# Manual dry fire (service-role JWT required — same as the sweeps):
curl -s -X POST https://<project-ref>.supabase.co/functions/v1/photo-reap \
  -H "Authorization: Bearer <service_role_key>" -H "Content-Type: application/json" -d '{}'
# → {"ok":true,"scanned":N,"deleted":M,"kept_disputed":K,"retention_days":30}
```

```sql
select jobname, schedule from cron.job where jobname = 'photo-reap';
```

## Disable

```sql
select cron.unschedule('photo-reap');
```

## Files

- `supabase/functions/photo-reap/reap.ts` — pure `shouldReapPhoto` predicate.
- `supabase/functions/photo-reap/index.ts` — the Edge Function (service-role only).
- `supabase/migrations/20260707130000_photo_reap_cron.sql` — cron + tunable seed.
- `supabase/migrations/20260707140000_photo_reap_vault_url.sql` — Vault secrets.
- `supabase/migrations/20260707150000_reapable_photos_rpc.sql` — cross-schema RPC.
- `lib/gear/compressPhoto.ts` — client-side shrink, wired into `app/(tabs)/play.tsx`.
- `lib/server/photo-reap.test.ts` — unit tests for the predicate (8, all pass).
