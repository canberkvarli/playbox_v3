-- Operator dispute-support + abuse/quarantine actions (Phase 4, Tasks 3 & 4).
--
-- These are the operator/support write actions ops invoke from Supabase
-- Studio's SQL Editor (which runs as postgres) when adjudicating disputes,
-- triaging the abuse/quarantine queue, and watching fleet health. Each mirrors
-- the SECURITY DEFINER + revoke-from-public + grant-to-(postgres, service_role)
-- shape of public.op_view_audit (20260427120000_operator_functions.sql) exactly,
-- so they are invokable as postgres (Studio) but NOT from client JWTs.
--
-- ════════════════════════════════════════════════════════════════════════════
-- MONEY-SAFETY RULE — support NEVER calls iyzico directly.
-- ════════════════════════════════════════════════════════════════════════════
-- A refund is NOT a direct iyzico call here. op_resolve_dispute(...,'refund')
-- only SETS reservations.reversal_eligible_at; the already-tested, audited
-- Phase 2 settlement worker (settlement/decide.ts) then performs the real money
-- move on its next tick — REFUND if the deposit is currently 'captured', else
-- RELEASE the still-held hold. Money is moved ONLY by the settlement worker, via
-- the flags these functions set. This keeps the single proven money path and
-- avoids a support-initiated double-refund / un-audited capture.
--
-- Marking a reservation disputed (op_mark_disputed) PAUSES auto-settlement:
-- the Task 2 settlement candidate query skips rows with disputed_at set. Clearing
-- disputed_at (op_resolve_dispute, either branch) RESUMES settlement.
--
-- Read-only helpers (op_attention_queue / op_station_health) are the "needs a
-- human" and fleet-health lists ops scan in Studio.

----------------------------------------------------------------
-- op_dispute_timeline — ONE ordered cross-source record of everything that
-- happened to a reservation: the physical BLE station events couriered from
-- the device + the reservation lifecycle audit rows + the synthetic money
-- milestones derived from the reservation's own timestamp columns. This is the
-- SQL mirror of the pure buildDisputeTimeline() merger
-- (supabase/functions/_shared/disputeTimeline.ts).
--
-- Sources (union all), all ordered by `at`:
--   'reservation' — public.reservation_events rows (at = event.at)
--   'station'     — public.station_events joined via
--                   reservations.ble_session_id = station_events.session_id
--                   (at = received_at, the courier-receive time; wall_ts + seq
--                   carried in detail)
--   'deposit'     — one synthetic row per NON-NULL reservation milestone column
----------------------------------------------------------------
create or replace function public.op_dispute_timeline(p_reservation_id uuid)
returns table (
  at      timestamptz,
  source  text,
  kind    text,
  detail  jsonb
)
language sql
security definer
set search_path = public
as $$
  -- reservation lifecycle audit rows
  select re.at, 'reservation'::text as source, re.kind, re.payload as detail
  from public.reservation_events re
  where re.reservation_id = p_reservation_id

  union all

  -- physical BLE station events for this reservation's session
  select se.received_at as at,
         'station'::text as source,
         se.event as kind,
         jsonb_build_object('wall_ts', se.wall_ts, 'seq', se.seq, 'gate', se.gate) as detail
  from public.reservations r
  join public.station_events se
    on se.session_id = r.ble_session_id
  where r.id = p_reservation_id
    and r.ble_session_id is not null

  union all

  -- synthetic money milestones: one row per NON-NULL timestamp column
  select m.at, 'deposit'::text as source, m.kind, null::jsonb as detail
  from public.reservations r
  cross join lateral (
    values
      (r.opened_at,            'gate_opened_at'),
      (r.returned_at,          'returned_at'),
      (r.release_eligible_at,  'release_eligible'),
      (r.penalty_eligible_at,  'penalty_eligible'),
      (r.reversal_eligible_at, 'reversal_eligible'),
      (r.settled_at,           'settled(' || r.deposit_state || ')'),
      (r.disputed_at,          'disputed')
  ) as m(at, kind)
  where r.id = p_reservation_id
    and m.at is not null

  order by at;
$$;

comment on function public.op_dispute_timeline(uuid) is
  'Cross-source dispute record ops read in Supabase Studio: merges reservation_events + station_events (joined via ble_session_id = session_id) + non-null deposit milestones into one timeline ordered by time. SQL mirror of buildDisputeTimeline().';

revoke all on function public.op_dispute_timeline(uuid) from public;
grant execute on function public.op_dispute_timeline(uuid) to postgres, service_role;

----------------------------------------------------------------
-- op_mark_disputed — flag a reservation as under operator review. PAUSES
-- auto-settlement (the Task 2 candidate query skips disputed_at-set rows), so
-- the deposit is frozen until ops adjudicate via op_resolve_dispute.
--
-- Idempotent: if the row is already disputed we leave disputed_at / disputed_by
-- untouched (preserving the original flag time + operator) but REFRESH the
-- dispute_reason to the latest supplied text, and still append a breadcrumb so
-- the re-flag is auditable. Returns the resulting state as jsonb.
----------------------------------------------------------------
create or replace function public.op_mark_disputed(
  p_reservation_id uuid,
  p_reason         text,
  p_admin          text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_already   boolean;
  v_exists    boolean;
begin
  select (disputed_at is not null) into v_already
  from public.reservations
  where id = p_reservation_id;

  get diagnostics v_exists = row_count;
  if not v_exists then
    return jsonb_build_object('ok', false, 'error', 'reservation_not_found');
  end if;

  if v_already then
    -- already disputed: keep the original disputed_at/disputed_by, refresh reason
    update public.reservations
    set dispute_reason = coalesce(p_reason, dispute_reason)
    where id = p_reservation_id;
  else
    update public.reservations
    set disputed_at    = now(),
        dispute_reason = p_reason,
        disputed_by    = p_admin
    where id = p_reservation_id;
  end if;

  insert into public.reservation_events (reservation_id, kind, payload)
  values (
    p_reservation_id,
    'disputed',
    jsonb_build_object('reason', p_reason, 'admin', p_admin, 're_flag', v_already)
  );

  return jsonb_build_object(
    'ok', true,
    'reservation_id', p_reservation_id,
    'already_disputed', v_already,
    'note', 'settlement paused until op_resolve_dispute clears disputed_at'
  );
end;
$$;

comment on function public.op_mark_disputed(uuid, text, text) is
  'Operator action: flag a reservation as disputed (sets disputed_at/dispute_reason/disputed_by). Pauses auto-settlement; idempotent (re-flag refreshes reason only). Money is never moved here. Resolve via op_resolve_dispute.';

revoke all on function public.op_mark_disputed(uuid, text, text) from public;
grant execute on function public.op_mark_disputed(uuid, text, text) to postgres, service_role;

----------------------------------------------------------------
-- op_resolve_dispute — adjudicate a disputed reservation. p_action one of:
--
--   'refund' : set reversal_eligible_at = coalesce(reversal_eligible_at, now())
--              and clear disputed_at (resume settlement). The settlement worker
--              then REFUNDS-if-captured / RELEASES-if-held on its next tick —
--              the proven money path. This function does NOT call iyzico.
--   'uphold' : clear disputed_at only (resume settlement); the original
--              settlement precedence (penalty/release) stands.
--
-- Errors on an unknown action or a reservation that is not currently disputed.
-- Idempotent on the flags: re-running 'refund' coalesces reversal_eligible_at
-- (no second timestamp) and clearing an already-clear disputed_at is a no-op.
----------------------------------------------------------------
create or replace function public.op_resolve_dispute(
  p_reservation_id uuid,
  p_action         text,
  p_admin          text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_disputed boolean;
  v_exists   boolean;
begin
  if p_action not in ('refund', 'uphold') then
    return jsonb_build_object('ok', false, 'error', 'unknown_action', 'action', p_action);
  end if;

  select (disputed_at is not null) into v_disputed
  from public.reservations
  where id = p_reservation_id;

  get diagnostics v_exists = row_count;
  if not v_exists then
    return jsonb_build_object('ok', false, 'error', 'reservation_not_found');
  end if;

  if not v_disputed then
    return jsonb_build_object(
      'ok', false, 'error', 'not_disputed', 'reservation_id', p_reservation_id
    );
  end if;

  if p_action = 'refund' then
    -- Flag-only refund: the settlement worker performs the actual money move.
    -- coalesce keeps a prior reversal timestamp; clearing disputed_at resumes it.
    update public.reservations
    set reversal_eligible_at = coalesce(reversal_eligible_at, now()),
        disputed_at          = null
    where id = p_reservation_id;
  else -- 'uphold'
    update public.reservations
    set disputed_at = null
    where id = p_reservation_id;
  end if;

  insert into public.reservation_events (reservation_id, kind, payload)
  values (
    p_reservation_id,
    'dispute_resolved',
    jsonb_build_object('action', p_action, 'admin', p_admin)
  );

  return jsonb_build_object(
    'ok', true,
    'reservation_id', p_reservation_id,
    'action', p_action,
    'note', case p_action
      when 'refund' then 'reversal_eligible_at set; settlement worker will refund-if-captured/release-if-held (no direct iyzico call)'
      else 'disputed_at cleared; original settlement precedence stands'
    end
  );
end;
$$;

comment on function public.op_resolve_dispute(uuid, text, text) is
  'Operator action: resolve a disputed reservation. refund => set reversal_eligible_at (settlement worker refunds/releases — NEVER a direct iyzico call) and clear disputed_at; uphold => clear disputed_at only. Errors on unknown action or non-disputed row. Idempotent.';

revoke all on function public.op_resolve_dispute(uuid, text, text) from public;
grant execute on function public.op_resolve_dispute(uuid, text, text) to postgres, service_role;

----------------------------------------------------------------
-- op_unquarantine — release a deposit parked by the settlement worker after too
-- many failed attempts. Clears quarantined_at and resets settle_attempts to 0 so
-- the worker retries on its next tick (ops calls this AFTER fixing the root
-- cause, e.g. backfilling a missing hold_txn_id). Idempotent.
----------------------------------------------------------------
create or replace function public.op_unquarantine(
  p_reservation_id uuid,
  p_admin          text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_exists boolean;
begin
  update public.reservations
  set quarantined_at  = null,
      settle_attempts = 0
  where id = p_reservation_id;

  get diagnostics v_exists = row_count;
  if not v_exists then
    return jsonb_build_object('ok', false, 'error', 'reservation_not_found');
  end if;

  insert into public.reservation_events (reservation_id, kind, payload)
  values (
    p_reservation_id,
    'unquarantined',
    jsonb_build_object('admin', p_admin)
  );

  return jsonb_build_object(
    'ok', true,
    'reservation_id', p_reservation_id,
    'note', 'quarantined_at cleared + settle_attempts reset; settlement will retry'
  );
end;
$$;

comment on function public.op_unquarantine(uuid, text) is
  'Operator action: clear quarantined_at + reset settle_attempts so the settlement worker retries (call AFTER fixing the root cause). Idempotent.';

revoke all on function public.op_unquarantine(uuid, text) from public;
grant execute on function public.op_unquarantine(uuid, text) to postgres, service_role;

----------------------------------------------------------------
-- op_attention_queue — the "needs a human" list: every reservation that is
-- disputed OR quarantined, so ops can see at a glance what to act on. Backed by
-- the partial reservations_settlement_attention_idx. Read-only.
----------------------------------------------------------------
create or replace function public.op_attention_queue()
returns table (
  reservation_id    uuid,
  user_id           text,
  status            text,
  deposit_state     text,
  disputed_at       timestamptz,
  dispute_reason    text,
  quarantined_at    timestamptz,
  settle_attempts   int,
  settle_last_error text
)
language sql
security definer
set search_path = public
as $$
  select r.id, r.user_id, r.status::text, r.deposit_state,
         r.disputed_at, r.dispute_reason,
         r.quarantined_at, r.settle_attempts, r.settle_last_error
  from public.reservations r
  where r.disputed_at is not null
     or r.quarantined_at is not null
  order by coalesce(r.disputed_at, r.quarantined_at) asc;
$$;

comment on function public.op_attention_queue() is
  'Operator read: every disputed OR quarantined reservation (the needs-a-human list). Read-only.';

revoke all on function public.op_attention_queue() from public;
grant execute on function public.op_attention_queue() to postgres, service_role;

----------------------------------------------------------------
-- op_station_health — per-station fleet-health view: firmware, battery, courier
-- lag (last_event_seq - acked_seq), plus computed battery_low (<=30%) and stale
-- (no heartbeat in >1h) flags. Ordered worst-first: low battery first (nulls
-- last), then most-stale. Read-only.
----------------------------------------------------------------
create or replace function public.op_station_health()
returns table (
  station_id   text,
  fw_version   text,
  battery_pct  int,
  battery_mv   int,
  last_seen_at timestamptz,
  seq_drift    bigint,
  battery_low  boolean,
  stale        boolean
)
language sql
security definer
set search_path = public
as $$
  select s.station_id,
         s.fw_version,
         s.battery_pct,
         s.battery_mv,
         s.last_seen_at,
         (s.last_event_seq - s.acked_seq) as seq_drift,
         (s.battery_pct is not null and s.battery_pct <= 30) as battery_low,
         (s.last_seen_at < now() - interval '1 hour')        as stale
  from public.stations s
  order by s.battery_pct asc nulls last, s.last_seen_at asc nulls last;
$$;

comment on function public.op_station_health() is
  'Operator read: per-station fleet health (fw, battery, seq_drift = last_event_seq - acked_seq, battery_low <=30%, stale >1h). Ordered worst-first. Read-only.';

revoke all on function public.op_station_health() from public;
grant execute on function public.op_station_health() to postgres, service_role;
