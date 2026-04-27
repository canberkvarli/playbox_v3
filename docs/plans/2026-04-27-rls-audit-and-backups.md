# RLS audit + backup hardening checklist

**Date:** 2026-04-27
**Scope:** every table + RPC currently in `supabase/migrations/` plus a one-time pre-launch hardening list. Tables that exist only on the dashboard (e.g. `stations`, `user_profiles`, `sessions`, `follows` per the older schema doc) need a separate sweep — pull them into local migrations first via `npx supabase db pull`.

---

## 1. Per-table RLS audit

Legend:
- ✅ Hardened — RLS on, policies cover every operation, scope is correct
- ⚠ Watch — RLS on but worth a second look (security definer, public reads, etc.)
- ❌ Gap — RLS off or policies missing

### `public.user_cards` ✅
**Migration:** [20260422000000_user_cards.sql](../../supabase/migrations/20260422000000_user_cards.sql)
- RLS: enabled
- Policies: owner read / insert / update / delete (4 policies, all keyed off `auth.jwt() ->> 'sub'`)
- Notes: stores `iyzico_card_token` and `iyzico_card_user_key` — not the PAN, not CVV, but still sensitive. The owner-only policies are correct. Service role bypasses RLS as expected for the iyzico-* edge functions.
- ✅ No action.

### `public.app_config` ✅
**Migration:** [20260426120000_reservations.sql](../../supabase/migrations/20260426120000_reservations.sql)
- RLS: enabled
- Policies: authenticated read; no INSERT/UPDATE/DELETE policies (service-role only)
- Notes: contains tunable knobs (`reservation_hold_try`, tier thresholds, etc.). Read-everyone is intentional — clients need `terms_version` and `reservation_hold_try` for copy.
- ✅ No action.

### `public.reservations` ✅
**Migration:** [20260426120000_reservations.sql](../../supabase/migrations/20260426120000_reservations.sql)
- RLS: enabled
- Policies: owner read only; all writes go through Edge Functions on service role
- Notes: partial-unique indexes on `(user_id) where status='active'` and `(station_id, gate_id) where status='active'` enforce business rules atomically. Audit trail in `reservation_events`.
- ✅ No action.

### `public.reservation_events` ✅
**Migration:** [20260426120000_reservations.sql](../../supabase/migrations/20260426120000_reservations.sql)
- RLS: enabled
- Policies: owner read via JOIN to `reservations` (`exists (... where r.user_id = auth.jwt() ->> 'sub')`); writes service-role only
- Notes: append-only audit log. Cascade-delete from `reservations.id` so account deletion sweeps these too.
- ✅ No action.

### `public.user_reservation_locks` ✅
**Migration:** [20260426120000_reservations.sql](../../supabase/migrations/20260426120000_reservations.sql)
- RLS: enabled
- Policies: owner read only; writes service-role only
- ✅ No action.

### `public.terms_acceptances` ✅
**Migration:** [20260426120000_reservations.sql](../../supabase/migrations/20260426120000_reservations.sql)
- RLS: enabled
- Policies: owner read only; writes service-role only
- Notes: snapshot of `terms_version` at acceptance time + `ip` and `app_version` for dispute defensibility.
- ✅ No action.

### `public.user_push_tokens` ⚠
**Migration:** [20260426140000_push_tokens.sql](../../supabase/migrations/20260426140000_push_tokens.sql)
- RLS: enabled
- Policies: owner read / insert / update / delete (so the client can register its own token without a service-role hop)
- Notes: an Expo push token isn't truly secret (it's only useful with the project's FCM/APNs creds), but combined with knowing a user_id it could be abused for noise. The policies are scoped correctly. **Worth verifying the client does an UPSERT not an INSERT** (otherwise a re-launch on a new device leaves stale rows the user can't reach across devices).
- ⚠ Action: confirm `usePushToken` uses `.upsert()` with `onConflict: 'user_id'`. (It does — verified.)

---

## 2. RPCs

### `public.get_my_reservation_state()` ✅
**Migration:** [20260426120000_reservations.sql](../../supabase/migrations/20260426120000_reservations.sql)
- `security invoker` (default) — runs as the caller, RLS enforced
- Returns only the caller's own data via `auth.jwt() ->> 'sub'`
- Granted to `authenticated` only
- ✅ No action.

### `public.taken_gates(p_station_id, p_sport)` ⚠
**Migration:** [20260426150000_taken_gates.sql](../../supabase/migrations/20260426150000_taken_gates.sql)
- `security definer` — runs as the function owner, **bypasses RLS**
- Returns ONLY `gate_id` strings from `reservations` where `status='active'` for the given station/sport
- `set search_path = public` to prevent search-path injection
- Granted to `authenticated` only
- **Why definer is safe here:** the only data leaked is "which gate strings are currently held"; no user_ids, no times, no payment data. The picker UI needs this to mark "dolu" gates without knowing whose reservations they are.
- ⚠ Action: add a unit-style integration test that passes intentionally-bad params (`p_station_id='; drop table reservations;`, `p_sport=null`, etc.) to confirm no exfiltration. The query is parameterized + the search_path is locked, but explicit verification beats trust.

---

## 3. Server-only operations

These are critical paths that should NEVER run from a user JWT. Verify on each Edge Function deploy:

| Function | Auth required | Auth role check |
|---|---|---|
| reservation-create | user JWT | `getUserIdFromRequest()` — rejects null |
| reservation-cancel | user JWT | same |
| reservation-consume | user JWT | same |
| reservation-sweep | user JWT **or** service role | `getRoleFromRequest()` distinguishes; cron-mode requires `role='service_role'` |
| reservation-retry-capture | user JWT | rejects null |
| reservation-force-release | **service role only** | `getRoleFromRequest()` rejects everything except `'service_role'` with 403 |
| delete-account | user JWT | rejects null |
| iyzico-register-card / preauth / capture-release | user JWT | unchanged from existing |

Every function above uses `SUPABASE_SERVICE_ROLE_KEY` from the Edge Functions env. **Action:** confirm the dashboard shows a non-empty value for that secret on the production project (it's not autopopulated like ANON_KEY).

---

## 4. Pre-launch hardening checklist

### Backups
- [ ] Supabase Dashboard → Database → Backups: confirm **Daily Backups** is enabled (paid plans only — verify your tier).
- [ ] Confirm **Point-in-time Recovery** if your tier supports it (most useful within the first month after launch).
- [ ] Document the backup-restore runbook for `support@playbox.app` so a non-engineer can trigger a rollback in an emergency.

### Auth + secrets
- [ ] Rotate `SUPABASE_SERVICE_ROLE_KEY` if it has ever appeared in chat / pasted screenshots / committed `.env` files. Check `git log -- .env*` and `git log -- '*secrets*'`.
- [ ] In Vault: `sweep_url` and `service_role_key` for the pg_cron job — confirm they're set on the production project (the cron silently no-ops without them).
- [ ] In Edge Functions secrets: `IYZICO_BASE_URL` should point to **prod** (`https://api.iyzipay.com`), not sandbox, on launch day.

### RLS spot-checks (on real production DB)
Run these from the SQL editor against the live DB, with a regular user JWT in the auth context. All three should return empty / 0:

```sql
-- 1. Anon should see nothing
set role anon;
select count(*) from public.reservations;
select count(*) from public.user_cards;
select count(*) from public.terms_acceptances;
reset role;

-- 2. Authenticated user should not see other users' data
-- (run from the dashboard with "impersonate user" toggled to user A,
--  then count should equal A's own rows only)
select count(*) from public.reservations where user_id <> auth.jwt() ->> 'sub';
-- expect 0

-- 3. taken_gates should NOT return user_ids or counts beyond gate strings
select * from public.taken_gates('ist-taksim', 'football');
-- expect: text[] of gate_id strings, nothing else
```

### Production sanity tests
- [ ] Create a real test user, run a complete reserve → consume cycle with a real ₺20 hold against a real card (sandbox-graduated).
- [ ] Force a no-show, confirm pg_cron captures the hold within ~60 sec.
- [ ] Force a card-decline scenario, confirm `payment_failed` lock + the user-facing "kartını güncelle" CTA.
- [ ] Delete the test account; verify in the dashboard that user_cards, reservations, user_push_tokens, terms_acceptances rows are all gone for that user_id, AND that the iyzico merchant dashboard shows the card removed.

### What's NOT yet in this audit (scope gap)
The earlier `2026-04-15-supabase-schema.md` references tables (`stations`, `user_profiles`, `sessions`, `follows`, view `user_stats`) that aren't in the local migrations. Either they're in the dashboard but not in repo, or they were never built. **Action:**
1. `npx supabase db pull` to dump the live schema into a new migration file
2. Re-run §1 of this doc against the pulled schema
3. Especially scrutinize `user_profiles` (likely PII heavy) and any social tables (`follows`) for cross-user read leaks

---

## 5. One-pager TL;DR

- 7 tables, 2 RPCs, 9 Edge Functions audited.
- **No critical RLS gaps in the reservation system.** Every user-scoped table has correct owner-only reads; writes are funneled through service-role Edge Functions.
- **One ⚠** for `user_push_tokens` (verified: client uses upsert correctly) and **one ⚠** for `taken_gates` (security definer is intentional + scoped, but warrants an injection test).
- **Two items NOT in this doc** that need separate work: dashboard tables not yet in repo migrations (run `db pull`), and Supabase OTP rate limiting (covered by the next migration in this same session).
