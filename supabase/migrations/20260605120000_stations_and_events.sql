-- Server reconciliation v1
-- Phase 1, Task 1: the server learns physical truth from BLE events
-- relayed ("couriered") by phones.
--
-- Tables added here:
--   stations       — one row per physical kiosk/station. Tracks firmware,
--                    battery telemetry, and the monotonic sequence cursors
--                    used to reconcile server state against the device
--                    (acked_seq = highest seq the server has durably applied;
--                    last_event_seq = highest seq the server has ever seen).
--   station_events — append-only, signed event log couriered from devices via
--                    phones. `unique (station_id, seq)` is the courier dedupe
--                    key: the same physical event relayed by multiple phones
--                    collapses to a single row.
--                    DURABILITY VS RECONCILIATION are decoupled: a row is
--                    inserted durably FIRST with `reconciled_at` null
--                    (stored-but-not-yet-reconciled). Reconciliation sets
--                    `reconciled_at` only on success; a reconcile FAILURE leaves
--                    it null so the next ingest call (or the Phase 1 Task 5
--                    sweep) re-drives it. This is the key correctness property:
--                    the (station_id,seq) dedupe gate never masks an
--                    un-reconciled event, because reconcile is driven by
--                    `reconciled_at is null`, NOT by whether the insert was new.
--
-- This migration also links reservations to the BLE session / physical gate
-- that fulfils them, and adds the reconciliation lifecycle timestamps
-- (opened / returned / release / penalty / reversal eligibility).
--
-- New reservation_events `kind`s introduced across Phase 1 (audit rows written
-- by sign-unlock + the ingest-events reconciler; no schema change needed since
-- reservation_events.kind is free-text):
--   unlock_signed            — server signed a BLE unlock for this reservation
--   gate_opened              — station reported the gate physically opened
--   gate_closed              — station reported the gate physically closed
--   unlock_timeout           — gate never opened before the unlock window lapsed
--   return_timeout           — return window lapsed (session kept open)
--   ball_overdue             — borrowed ball not returned in time
--   abandoned                — session abandoned (no open / no return)
--   late_return_after_penalty — gate_closed arrived after penalty was eligible
--                               (drives reversal_eligible_at)
--
-- Secrets: each station's HMAC signing key lives in Supabase Vault, referenced
-- by `stations.secret_vault_id` (vault.secrets.id). It is nullable; when null,
-- the server falls back to an environment-variable shared secret. All access
-- to these tables is via Edge Functions running as the service role — clients
-- never touch them directly (RLS enabled, no permissive policies).

------------------------------------------------------------
-- stations: physical-device registry + reconciliation cursors
------------------------------------------------------------
create table if not exists public.stations (
  station_id      text primary key,                       -- e.g. 'ist-taksim'
  gate_count      int  not null default 1,
  fw_version      text,
  battery_mv      int,
  battery_pct     int,
  secret_vault_id uuid,                                    -- vault.secrets.id; null => env-var fallback
  acked_seq       bigint not null default 0,              -- highest seq durably applied by server
  last_event_seq  bigint not null default 0,              -- highest seq ever observed
  last_seen_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

alter table public.stations enable row level security;
-- No policies: only the service role (which bypasses RLS) may read/write.

------------------------------------------------------------
-- station_events: signed, couriered event log (dedupe on station_id+seq)
------------------------------------------------------------
create table if not exists public.station_events (
  id           bigserial primary key,
  station_id   text not null references public.stations(station_id),
  seq          bigint not null,
  event        text not null,
  gate         int,
  session_id   text,
  wall_ts      bigint not null,                            -- device wall-clock (epoch ms)
  sig          text not null,                              -- HMAC signature over the raw payload
  raw          jsonb not null,
  received_by  uuid,                                       -- phone/user that couriered this event
  received_at  timestamptz not null default now(),
  reconciled_at timestamptz,                                -- null => stored but not yet reconciled (retry queue)
  unique (station_id, seq)                                 -- courier dedupe key
);

create index if not exists station_events_session
  on public.station_events(session_id);

-- Partial index for the reconcile/retry drain: cheaply find the un-reconciled
-- rows for a station, ordered by seq. Failed reconciles stay null and are
-- retried by the next ingest call or the Phase 1 Task 5 sweep.
create index if not exists station_events_unreconciled_idx
  on public.station_events (station_id, seq) where reconciled_at is null;

alter table public.station_events enable row level security;
-- No policies: only the service role (which bypasses RLS) may read/write.

------------------------------------------------------------
-- reservations: link to the BLE session + reconciliation lifecycle
-- timestamps. `station_id` already exists (text not null) and is left
-- untouched.
--
-- gate identity stays on the existing reservations.gate_id (text); events
-- reconcile by ble_session_id, so no numeric gate column is added here.
-- station_events.gate holds the raw numeric gate from the BLE payload.
------------------------------------------------------------
alter table public.reservations add column if not exists ble_session_id        text;
alter table public.reservations add column if not exists opened_at             timestamptz;
alter table public.reservations add column if not exists returned_at           timestamptz;
-- PHASE 2 settlement precedence (money seam — Phase 1 only sets these flags, never moves money):
--   reversal_eligible_at  => a penalty may have been captured; REFUND it. Wins over penalty.
--   penalty_eligible_at   => capture the safety deposit/penalty (abandoned/not returned). Cleared on late return.
--   release_eligible_at    => baseline: release the hold (on-time/confirmed return or void).
-- A returned ball must never be penalized: gate_closed clears penalty_eligible_at when setting reversal_eligible_at.
alter table public.reservations add column if not exists release_eligible_at   timestamptz;
alter table public.reservations add column if not exists penalty_eligible_at   timestamptz;
alter table public.reservations add column if not exists reversal_eligible_at  timestamptz;

create index if not exists reservations_ble_session
  on public.reservations(ble_session_id);
