-- Operator dispute-support functions (Phase 4, Task 3).
--
-- Task 4 will extend this file with more operator helpers. For now it adds a
-- single read-only function ops drive from Supabase Studio's SQL Editor when
-- resolving "I returned it but got charged" disputes.
--
-- Mirrors the SECURITY DEFINER + revoke-from-public + grant-to-(postgres,
-- service_role) shape of public.op_view_audit (20260427120000_operator_functions.sql)
-- exactly, so it is invokable as postgres (Studio) but NOT from client JWTs.

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
