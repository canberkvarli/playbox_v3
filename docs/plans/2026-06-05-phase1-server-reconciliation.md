# Phase 1: Server Reconciliation — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or subagent-driven-development) to implement this plan task-by-task.

**Goal:** Make the server learn physical truth from BLE events relayed by courier phones — verify signed events, dedupe them, and drive the existing reservation lifecycle from `gate_opened`/`gate_closed` instead of guessing from a timer. This is what kills the wrongful-penalty failure mode (charging someone who actually returned the gear).

**Architecture:** A new `ingest-events` Supabase edge function accepts a batch of station-signed events from ANY authenticated phone (the courier — it may not be the renter). It verifies each event's HMAC against the per-station secret, dedupes by `(station_id, seq)` via a new `station_events` table, and reconciles each event into the existing `reservations` + `reservation_events` model. Money is **NOT** moved here — reconciliation appends audit rows and sets `*_eligible` flags behind a clean seam; Phase 2 wires the iyzico calls. A new abandoned-session sweep flags consumed reservations that never produced a `gate_closed`. The whole loop is testable **now** with a simulator that signs synthetic events — no firmware required.

**Tech stack:** Supabase (Postgres + Deno edge functions, Web Crypto HMAC), existing `_shared/blesign.ts` / `_shared/auth.ts` / `_shared/cors.ts`, the Phase 0 protocol contract (`lib/ble/protocol.ts` canonical signing string), Deno test for the edge-function core, Jest for the Node-side `lib/server/eventVerify.ts`.

---

## Grounding facts (verified against the repo — do not re-discover)

- **HMAC:** `supabase/functions/_shared/blesign.ts` → `hmacSha256Hex(secretHex, payload)` decodes a **64-hex-char secret into 32 raw bytes** and signs with Web Crypto (`crypto.subtle`). Event verification MUST use the **same 32-raw-byte key** — NOT the secret as a utf8 string.
- **⚠️ Phase 0 carryover bug:** `lib/server/eventVerify.ts` currently does `createHmac("sha256", secret)` treating `secret` as utf8. That will never match firmware/blesign. **Task 2 fixes this** (hex-decode the key).
- **Canonical event string (Phase 0):** `eventSigningPayload(e)` = `event|gate|session_id|seq|ts|extra` (extra = integer mv for battery events, else ""). Empty slot = "" when the field's key is absent. Firmware serialization contract pinned in `lib/ble/protocol.ts`.
- **Reservation states** (`reservation_status`): `active` → (`consumed` | `cancelled` | `expired_captured` | `expired_released`). Created by `reservation-create` (places iyzico preauth in `reservations.hold_id`), `consumed` by `reservation-consume` (QR scan; releases the initial hold). `reservation-sweep` (pg_cron, 60s) captures expired holds.
- **`reservation_events`**: append-only audit. Columns `id bigserial, reservation_id, kind text, payload jsonb, at timestamptz`. Existing kinds: `created`, `consumed`, `expired_capture_ok`, etc. We ADD: `gate_opened`, `gate_closed`, `unlock_timeout`, `return_timeout`, `abandoned`, `late_return_after_penalty`.
- **🔑 Keystone gap:** the BLE `session_id` is **client-ephemeral and NOT persisted server-side**. `sign-unlock` receives it as a request param and signs it, but nothing records it on the reservation. Without persisting it, an incoming `gate_closed` (which only carries `session_id`) can't be tied back to a reservation. **Task 3 persists it.**
- **Secret storage decision:** move to a `stations` table with the secret in **Supabase Vault** (pgsodium), fetched via service role. Keep `getStationSecret()` as a fallback to env vars during migration.
- **Money decision:** reconcile-only. NO iyzico calls in Phase 1. Reconciliation sets `release_eligible_at` / `penalty_eligible_at` markers + audit rows; Phase 2 consumes them.

---

## Task 1: Migration — `stations`, `station_events`, reservation linkage

**Files:**
- Create: `supabase/migrations/20260605120000_stations_and_events.sql`

**Step 1: Write the migration**
```sql
-- stations: per-station identity, secret (Vault ref), telemetry, courier ack cursor
create table if not exists public.stations (
  station_id        text primary key,                 -- e.g. 'DEV-001'
  gate_count        int  not null default 1,
  fw_version        text,
  battery_mv        int,
  battery_pct       int,
  secret_vault_id   uuid,                              -- vault.secrets id (nullable: env-var fallback)
  acked_seq         bigint not null default 0,         -- highest contiguous seq persisted
  last_event_seq    bigint not null default 0,
  last_seen_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- station_events: raw, verified, deduped courier telemetry. Dedupe = unique(station_id, seq).
create table if not exists public.station_events (
  id            bigserial primary key,
  station_id    text not null references public.stations(station_id),
  seq           bigint not null,
  event         text   not null,
  gate          int,
  session_id    text,
  wall_ts       bigint not null,            -- advisory; do NOT use for billing
  sig           text   not null,
  raw           jsonb  not null,
  received_by   uuid,                       -- uploader (courier) user id; NULL if service/sim
  received_at   timestamptz not null default now(),
  unique (station_id, seq)                  -- idempotent courier dedupe
);
create index if not exists station_events_session_idx on public.station_events(session_id);

-- Link a reservation to its BLE session + station/gate so events reconcile back to it.
alter table public.reservations add column if not exists ble_session_id text;
alter table public.reservations add column if not exists station_id text;
alter table public.reservations add column if not exists gate int;
alter table public.reservations add column if not exists opened_at timestamptz;       -- first gate_opened
alter table public.reservations add column if not exists returned_at timestamptz;     -- gate_closed
alter table public.reservations add column if not exists release_eligible_at timestamptz;  -- money seam
alter table public.reservations add column if not exists penalty_eligible_at timestamptz;  -- money seam
create index if not exists reservations_ble_session_idx on public.reservations(ble_session_id);

-- RLS: clients never read/write these directly; edge functions use service role.
alter table public.stations enable row level security;
alter table public.station_events enable row level security;
-- (no permissive policies → only service role bypasses RLS)
```

> VERIFY before running: check the real `reservations` columns (some of `station_id`/`gate` may already exist — `add column if not exists` is safe, but reconcile types). Confirm the `vault` schema/pgsodium is available (`select * from pg_extension where extname='supabase_vault';`). If Vault isn't enabled, enable it or fall back to env-var secrets for now and leave `secret_vault_id` null.

**Step 2: Apply locally / to a branch DB**
Run via `supabase db push` against a dev branch, or the Supabase MCP `apply_migration`. Expected: tables created, columns added, no error.

**Step 3: Seed a test station + secret**
Insert `DEV-001` with `gate_count=3`. Store its 64-hex secret in Vault (or rely on env `PLAYBOX_STATION_SECRET_DEV_001`). Keep the hex secret handy for the simulator (Task 6).

**Step 4: Commit**
```bash
git add supabase/migrations/20260605120000_stations_and_events.sql
git commit -m "feat(db): stations + station_events tables; reservation BLE-session linkage"
```

---

## Task 2: Event HMAC verification in both runtimes (+ fix Phase 0 key bug)

**Files:**
- Modify: `lib/server/eventVerify.ts` + `lib/server/eventVerify.test.ts` (Node/Jest — fix hex-key)
- Create: `supabase/functions/_shared/eventverify.ts` (Deno/Web Crypto — authoritative for the edge function)
- Create: `supabase/functions/_shared/eventverify.test.ts` (Deno test)

**Step 1 (Node fix — failing test):** In `eventVerify.test.ts`, change the `sign()` helper to key the HMAC with the **hex-decoded 32 bytes** (matching blesign), and assert `verifyEventSig` accepts it. This will FAIL against the current utf8-key implementation.
```ts
import { createHmac } from "node:crypto";
const SECRET_HEX = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";
function keyBytes(hex: string) { return Buffer.from(hex, "hex"); }
function sign(e: any) {
  const { sig, ...rest } = e;
  return { ...rest, sig: createHmac("sha256", keyBytes(SECRET_HEX)).update(eventSigningPayload({ ...rest, sig: "" })).digest("hex") };
}
it("verifies an event signed with the hex-decoded 32-byte key", () => {
  const e = sign({ event: "gate_closed", gate: 1, session_id: "s1", seq: 2, ts: 100, sig: "" });
  expect(verifyEventSig(e, SECRET_HEX)).toBe(true);
});
```

**Step 2:** Run `npx jest lib/server/eventVerify.test.ts --ci` → FAIL (utf8 key mismatch).

**Step 3 (Node impl):** Change `verifyEventSig(e, secretHex)` to decode the hex secret to bytes before HMAC: `createHmac("sha256", Buffer.from(secretHex, "hex"))`. Update the doc comment: secret is **64-hex (32 bytes)**, decoded to raw key bytes to match firmware + blesign. Keep constant-time compare + non-string-sig guard. Update older tests that used a utf8 secret to use `SECRET_HEX`.

**Step 4:** `npx jest lib/server/eventVerify.test.ts --ci` → PASS.

**Step 5 (Deno authoritative verify):** Create `_shared/eventverify.ts` mirroring `blesign.ts` style:
```ts
import { eventSigningPayload } from "../../../lib/ble/protocol.ts"; // or inline the canonical-string fn if cross-import is awkward in Deno
// hmacSha256Hex(secretHex, payload) already exists in blesign.ts — reuse it.
export async function verifyEventSig(ev, secretHex) {
  const expected = await hmacSha256Hex(secretHex, eventSigningPayload(ev));
  // constant-time-ish compare on equal-length lowercased hex
  const a = expected, b = String(ev.sig ?? "").toLowerCase();
  if (a.length !== b.length) return false;
  let diff = 0; for (let i=0;i<a.length;i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
```
> NOTE on cross-import: Deno edge functions can't import RN-style `lib/ble/protocol.ts` if its path/tsconfig differs. Cleanest: add a tiny `_shared/canonical.ts` that re-implements `eventSigningPayload` (pure, ~6 lines) AND a Jest/Deno parity test asserting both runtimes produce identical strings for a fixed event set. The canonical string is the contract — pin it with a shared fixture.

**Step 6 (Deno test):** `_shared/eventverify.test.ts` signs with the same `hmacSha256Hex` + hex key and asserts verify true / tamper false / wrong-secret false. Run `deno test supabase/functions/_shared/`.

**Step 7: Commit** `fix(server): HMAC event verify uses hex-decoded 32-byte key (Node+Deno parity)`

---

## Task 3: Persist session_id ↔ reservation linkage at sign-unlock (keystone)

**Files:** Modify `supabase/functions/sign-unlock/index.ts`

**Behavior:** When `sign-unlock` signs an `unlock` for `{station_id, gate, session_id}`, persist that linkage on the caller's active reservation so future events reconcile: set `reservations.ble_session_id = session_id`, `station_id`, `gate` on the user's `active`/`consumed` reservation for that gate. (Confirm which reservation: the one matching `user_id` + `gate` + status in (`active`,`consumed`).) Append `reservation_events(kind='unlock_signed', payload={session_id, gate, ts})`.

**Step 1:** Write a test (Deno test or a documented manual check via `supabase functions serve`): calling sign-unlock with a known session_id results in the reservation row carrying that `ble_session_id`. (If sign-unlock lacks a test harness today, add a thin extractable `linkSession(supabase, userId, stationId, gate, sessionId)` helper and unit-test that in isolation.)

**Step 2–4:** Implement the helper, wire it into sign-unlock after signature success, verify the row is updated.

**Guard:** only set linkage on a reservation the caller owns and that is in a live state; never overwrite a different user's session. Idempotent (re-signing the same session_id is a no-op).

**Step 5: Commit** `feat(sign-unlock): persist ble_session_id↔reservation linkage for event reconciliation`

---

## Task 4: `ingest-events` edge function (verify → dedupe → reconcile)

**Files:** Create `supabase/functions/ingest-events/index.ts` + a pure core `supabase/functions/ingest-events/reconcile.ts` + `reconcile.test.ts` (Deno test).

**Contract:**
- **Request** (POST, authenticated — any logged-in user; courier ≠ renter is allowed):
  `{ station_id: string, events: StationEvent[], ack?: { acked_seq: number } }`
- **Auth:** extract uploader `user_id` from JWT `sub` (reuse `_shared/auth.ts`). The uploader is NOT trusted to vouch for events — each event is trusted via its `sig` only.
- **Per event:** load station secret (Vault via `station_id`, else env fallback). `verifyEventSig(ev, secretHex)`. On invalid sig → skip + count `rejected` (optionally log). On valid → upsert into `station_events` with `on conflict (station_id, seq) do nothing` (dedupe). If newly inserted, run `reconcile()`.
- **Response:** `{ accepted, deduped, rejected, acked_seq }` where `acked_seq` = the highest contiguous seq now persisted for the station (so the phone can tell the station to drop buffered events ≤ acked_seq). Update `stations.acked_seq`, `last_event_seq`, `last_seen_at`.

**`reconcile(supabase, station_id, ev)` — pure-ish, unit-tested:**
- `gate_opened` (has session_id): find reservation by `ble_session_id`; set `opened_at` if null; append `reservation_events(kind='gate_opened')`. (Capture-eligible marker is Phase 2; here just record.)
- `gate_closed` (has session_id): find reservation by `ble_session_id`; set `returned_at`; transition to a returned state (reuse `consumed`/add a terminal note — DO NOT invent a conflicting status; prefer setting `returned_at` + `release_eligible_at = now()` and appending `reservation_events(kind='gate_closed')`). If the reservation was already `penalty_eligible_at` set (late return after penalty) → also append `kind='late_return_after_penalty'` and set a `reversal_eligible_at` marker. **Idempotent**: a replayed gate_closed must not double-append.
- `battery_low` / `battery_critical` / `boot`: update `stations.battery_mv/pct`, `last_seen_at`; append a lightweight station log (NOT reservation_events).
- `unlock_timeout` / `return_timeout` (session_id): append `reservation_events(kind=event)`; for unlock_timeout set `release_eligible_at` (void path — no dispense).
- **No iyzico calls anywhere.** Only audit rows + `*_eligible_at` flags. Leave explicit `// PHASE 2: iyzicoRelease/iyzicoCapture here` markers.

**Tests (`reconcile.test.ts`, Deno):** drive `reconcile()` against a fake/seeded supabase (or a thin in-memory mock of the few queries) for: gate_opened sets opened_at; gate_closed sets returned_at + release_eligible_at + appends once; replayed gate_closed is a no-op; battery updates station; unlock_timeout sets release_eligible_at; gate_closed with no matching session_id is recorded in station_events but reconciles to nothing (logged).

**Commit** `feat(ingest-events): verify+dedupe courier events; reconcile into reservation lifecycle (money behind seam)`

---

## Task 5: Abandoned-session sweep

**Files:** Modify `supabase/functions/reservation-sweep/index.ts` (add a pass) OR create `supabase/functions/session-sweep/index.ts` + a cron migration mirroring `20260426130000_reservation_cron.sql`.

**Behavior:** find reservations that are live/`consumed`, have `opened_at` set, NO `returned_at`, and `now() - opened_at > max_session_duration` (from `app_config`, default e.g. 90 min). For each → set `penalty_eligible_at = now()`, append `reservation_events(kind='abandoned')`. **No capture call** (Phase 2). Idempotent: skip rows already flagged.

**Edge case (reversal):** if a `gate_closed` later arrives for a penalty-flagged reservation, Task 4 already records `late_return_after_penalty` + `reversal_eligible_at`. The sweep must NOT re-flag a row that has `returned_at`.

**Test:** seed a consumed reservation with `opened_at` 2h ago, no returned_at → sweep sets `penalty_eligible_at` + one `abandoned` event; running twice doesn't duplicate; a row with `returned_at` is untouched.

**Commit** `feat(sweep): flag abandoned (opened, never-returned) sessions as penalty-eligible`

---

## Task 6: Simulator harness — test the whole loop NOW (no firmware)

**Files:** Create `supabase/functions/ingest-events/_sim/simulate.ts` (a Deno script) + a README snippet.

**What it does:** Given the `DEV-001` hex secret, it builds and signs a realistic event sequence using the **same canonical string** as firmware, then POSTs batches to `ingest-events` (local `supabase functions serve` or a branch URL) and asserts DB state. Scenarios:
1. **Happy path:** seed reservation (consumed, ble_session_id='sim-1') → POST `gate_opened` then `gate_closed` → assert `opened_at`, `returned_at`, `release_eligible_at` set; two `reservation_events` appended; `stations.acked_seq` advanced.
2. **Replay/dedupe:** re-POST the same batch → `deduped` count rises, no new reservation_events, state unchanged.
3. **Out-of-order courier:** POST `gate_closed` (seq 5) before `gate_opened` (seq 4) → both land via `station_events`; reconciliation still correct (returned_at set; opened_at backfilled when seq4 arrives).
4. **Tampered sig:** flip a byte → `rejected` count rises; no state change.
5. **Wrong/foreign session_id:** `gate_closed` for an unknown session → stored in station_events, reconciles to nothing (logged), no reservation touched.
6. **Abandoned:** seed an opened-but-never-returned reservation 2h old → run session-sweep → `penalty_eligible_at` set.
7. **Late return after penalty:** then POST `gate_closed` → `late_return_after_penalty` + `reversal_eligible_at` set.

**Run:** `deno run --allow-net --allow-env simulate.ts` against `supabase functions serve`. This is the **acceptance gate**: when it's green, the server loop is proven and firmware just replaces the simulator.

**Commit** `test(ingest-events): end-to-end courier simulator (7 scenarios, no firmware needed)`

---

## Out of scope (later)
- **App-side gossip-sync** (drain station event buffer on any connect, POST to ingest-events, relay `acked_seq` back to firmware as an `ack` command) — Phase 3.
- **Real money moves** (consume `release_eligible_at` / `penalty_eligible_at` / `reversal_eligible_at` via iyzico) — Phase 2.
- **Firmware emit/replay** — Phase 0 Tasks 5–6, blocked on hardware.

## Definition of done (Phase 1)
- Migration applied; `stations` + `station_events` exist; reservations carry `ble_session_id`.
- `verifyEventSig` (Node + Deno) accepts firmware-style hex-key signatures; parity test green.
- `sign-unlock` persists the session linkage.
- `ingest-events` verifies, dedupes by `(station_id, seq)`, reconciles into reservation lifecycle, returns `acked_seq`; reconcile core unit-tested.
- Abandoned sweep flags penalty-eligible sessions.
- **Simulator: all 7 scenarios green** — the loop is provably correct before hardware arrives.
```
