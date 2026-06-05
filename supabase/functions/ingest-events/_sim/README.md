# ingest-events — LIVE end-to-end simulator

`simulate.ts` is the **WET integration gate** for the ingest-events function. It
is **write-only** and runs against a **running Supabase stack** (local or a
deployed project, e.g. before a TestFlight backend cut). It signs the same
scenario events the deterministic Jest loop test drives
(`lib/server/ingest-loop.test.ts`) and POSTs them to the live function, checking
the returned `{ accepted, deduped, rejected, reconciled, acked_seq }` envelope.

> The **Jest test is the proof of the orchestration logic** (pure, deterministic,
> runs in CI with no DB). **This script is the proof the Supabase wiring** —
> migrations, the `station_events` `onConflict (station_id,seq)` upsert, RLS, the
> `stations` cursor update, JWT auth, CORS — **is correct end-to-end.** Run it
> once the stack is deployed. **Do NOT run it in CI / without a live stack.**

## What it does NOT do

It asserts the **response envelope** per scenario, not reservation-row state
(that needs a DB read). After a run, confirm the row mutations with the SQL at
the bottom.

## Prerequisites — bring the stack up

```sh
# 0. From repo root, with the Supabase CLI installed and Docker running.
supabase start                         # local stack (or target a deployed project)

# 1. Apply migrations (creates station_events.reconciled_at, the reconciliation
#    columns on reservations, stations.acked_seq/last_event_seq, etc.)
supabase db push

# 2. Seed the DEV-001 station + its secret (env-var fallback path: the function
#    reads PLAYBOX_STATION_SECRET_DEV_001 when stations.secret_vault_id is null).
#    Pick a 64-hex secret and use the SAME value for STATION_SECRET_HEX below.
psql "$DATABASE_URL" <<'SQL'
  insert into stations (station_id, secret_vault_id, acked_seq, last_event_seq)
  values ('DEV-001', null, 0, 0)
  on conflict (station_id) do update set acked_seq = 0, last_event_seq = 0;
SQL

# 3. Seed reservations whose ble_session_id match the simulator's per-run
#    sessions. The simulator prints its RUN id and uses sessions:
#      <RUN>-happy, <RUN>-ghost (intentionally NO reservation),
#      <RUN>-late (needs penalty_eligible_at set).
#    Easiest path: run the simulator once to read the RUN id from its first log
#    line, then seed:
psql "$DATABASE_URL" <<'SQL'
  -- replace <RUN> with the id the simulator printed
  insert into reservations (id, status, ble_session_id)
    values (gen_random_uuid(), 'consumed', '<RUN>-happy');
  insert into reservations (id, status, ble_session_id, opened_at, penalty_eligible_at)
    values (gen_random_uuid(), 'consumed', '<RUN>-late',
            now() - interval '2 hours', now() - interval '1 hour');
  -- NOTE: do NOT seed '<RUN>-ghost' — scenario 5 asserts no_reservation.
SQL
```

> Re-runs use a **fresh `RUN` id** (millis-based), so `station_events` seqs never
> collide on dedupe across runs. To re-run the SAME seqs deterministically,
> `truncate station_events;` and reset `stations.acked_seq = 0` first.

## Serve + run

```sh
# 4. Serve the function (a separate terminal). Pass the station secret as env so
#    the function's env-var fallback resolves it.
PLAYBOX_STATION_SECRET_DEV_001=<64-hex-secret> \
  supabase functions serve ingest-events

# 5. Run the simulator. AUTH_JWT can be any valid Supabase user JWT
#    (anon/service-role won't carry a user; mint a user session token).
INGEST_URL="http://127.0.0.1:54321/functions/v1/ingest-events" \
STATION_SECRET_HEX="<64-hex-secret>" \
AUTH_JWT="<a-supabase-user-jwt>" \
STATION_ID="DEV-001" \
  deno run --allow-net --allow-env simulate.ts
```

Expected: each scenario prints `PASS … → {…counts…}` and the footer reads
`N passed, 0 failed.`

## Verify reservation mutations (manual)

```sql
-- opened_at / returned_at / release_eligible_at / reversal_eligible_at
select ble_session_id, opened_at, returned_at, release_eligible_at, reversal_eligible_at
from reservations where ble_session_id like '<RUN>-%' order by ble_session_id;

-- the durable queue: everything reconciled? (reconciled_at NOT null)
select seq, event, session_id, reconciled_at
from station_events where station_id = 'DEV-001' order by seq;

-- cursor advanced over contiguous reconciled seqs only
select station_id, acked_seq, last_event_seq from stations where station_id = 'DEV-001';
```

The tampered-sig event (scenario 4) must be **absent** from `station_events`
(rejected before storage). The `<RUN>-ghost` event (scenario 5) must be
**present and reconciled** with **no** matching reservation row mutated.
