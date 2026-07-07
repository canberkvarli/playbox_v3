# RUNBOOK — Play Stats (real profile stats)

Deploys the `play_sessions` table + `get_play_stats()` RPC that back the real
profile stats (games / total minutes / streak / city rank), replacing the old
hardcoded dummy `ME` object.

## What ships how

- **Client** (profile screen, `recordPlaySession`, `useProfileStats`) ships via
  **OTA**. It is SAFE to ship BEFORE the migration is applied: the stats RPC is
  best-effort — if the table/function doesn't exist yet, `get_play_stats` errors,
  the hook falls back to zeros, and the profile just shows the first-time empty
  state ("İlk oyununa hazır mısın?"). Nothing crashes; no rows are written that
  can't be (insert just fails silently in the try/catch).
- **Backend** is the migration below. You apply it. This dev env cannot deploy
  Supabase, so run these yourself.

## 1. Apply the migration

File: `supabase/migrations/20260707120000_play_sessions.sql`

**Option A — Supabase CLI (from your machine, project linked):**

```bash
supabase db push
```

**Option B — Dashboard SQL editor:** open the project → SQL Editor → paste the
full contents of `supabase/migrations/20260707120000_play_sessions.sql` → Run.

The migration is idempotent (`create table if not exists`, `create or replace
function`, `drop policy if exists` before each `create policy`) so re-running is
safe.

## 2. Verify RLS

In the SQL editor:

```sql
-- RLS is ON
select relrowsecurity from pg_class where relname = 'play_sessions';
-- expect: t

-- exactly the two own-row policies, no update/delete
select policyname, cmd from pg_policies where tablename = 'play_sessions';
-- expect: play_sessions_insert_own (INSERT), play_sessions_select_own (SELECT)
```

## 3. Confirm the RPC

As an **authenticated** user (e.g. from the app, or with a user JWT), call:

```sql
select * from public.get_play_stats();
-- returns one row: games, total_minutes, streak_days, city_rank, city_total_players
```

For a brand-new user it returns `0, 0, 0, null, null`. The `authenticated` role
has `execute` granted; `anon` does not.

## 4. Ship the client (OTA)

Per project convention, OTA needs the environment flag:

```bash
eas update --branch production --environment production -m "feat: real play stats"
```

## Notes

- Demo/review mode (`demoMode`) NEVER writes a `play_sessions` row and the stats
  hook skips the RPC → reviewers always see the clean first-time profile.
- `user_id` is filled by a DB `default auth.uid()` and enforced by the insert
  RLS policy — the client never sends it.
- Streak + city rank are computed in `Europe/Istanbul` inside the
  `security definer` function, which aggregates across users for city rank
  without exposing any individual rows.
