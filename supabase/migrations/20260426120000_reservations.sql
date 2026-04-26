-- Reservation system v1
-- Design: docs/plans/2026-04-26-reservation-system-design.md
--
-- Tables: app_config, reservations, reservation_events,
--         user_reservation_locks, terms_acceptances
-- RPC:    get_my_reservation_state()
--
-- All user-scoped writes go through Edge Functions (service role).
-- RLS only authorises reads scoped to the caller's JWT sub. This matches
-- the convention in 20260422000000_user_cards.sql so the reservation
-- system joins cleanly with existing card storage.

------------------------------------------------------------
-- app_config: tunable runtime values, single source of truth
------------------------------------------------------------
create table if not exists public.app_config (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.app_config enable row level security;

-- Any authenticated user can read; only service role can write.
create policy "app_config authenticated read"
  on public.app_config for select
  to authenticated
  using (true);

insert into public.app_config (key, value) values
  ('reservation_hold_try',      '20'::jsonb),
  ('reservation_lock_min',      '30'::jsonb),
  ('grace_seconds',             '120'::jsonb),
  ('terms_version',             '1'::jsonb),
  ('velocity_per_hour',         '3'::jsonb),
  ('velocity_per_day',          '8'::jsonb),
  ('tier1_captures',            '3'::jsonb),
  ('tier1_window_days',         '30'::jsonb),
  ('tier1_lock_hours',          '24'::jsonb),
  ('tier2_captures',            '5'::jsonb),
  ('tier2_window_days',         '30'::jsonb),
  ('tier2_lock_days',           '7'::jsonb),
  ('tier3_captures',            '10'::jsonb),
  ('tier3_window_days',         '90'::jsonb)
on conflict (key) do nothing;

------------------------------------------------------------
-- reservations: source of truth for every hold the system places
------------------------------------------------------------
do $$ begin
  create type reservation_status as enum (
    'active',
    'consumed',
    'cancelled',
    'expired_captured',
    'expired_released'
  );
exception when duplicate_object then null; end $$;

create table if not exists public.reservations (
  id              uuid primary key default gen_random_uuid(),
  user_id         text not null,                                                            -- Supabase JWT `sub`
  station_id      text not null,                                                            -- e.g. 'ist-taksim'
  sport           text not null check (sport in ('football','basketball','volleyball','tennis')),
  gate_id         text not null,                                                            -- specific gate per design Q8
  hold_id         text,                                                                     -- iyzico hold reference (null until preauth returns)
  hold_amount_try int  not null,
  terms_version   int  not null,
  status          reservation_status not null default 'active',
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null,
  terminal_at     timestamptz,
  client_meta     jsonb
);

-- Enforce business rules at the index layer (atomic, race-safe):
create unique index if not exists reservations_one_active_per_user
  on public.reservations(user_id) where status = 'active';

create unique index if not exists reservations_one_active_per_gate
  on public.reservations(station_id, gate_id) where status = 'active';

-- Fast paths:
create index if not exists reservations_active_expiring
  on public.reservations(expires_at) where status = 'active';

create index if not exists reservations_user_recent
  on public.reservations(user_id, created_at desc);

alter table public.reservations enable row level security;

create policy "reservations owner read"
  on public.reservations for select
  to authenticated
  using (user_id = auth.jwt() ->> 'sub');

------------------------------------------------------------
-- reservation_events: append-only audit log for disputes & abuse
------------------------------------------------------------
create table if not exists public.reservation_events (
  id              bigserial primary key,
  reservation_id  uuid not null references public.reservations(id) on delete cascade,
  kind            text not null,
  payload         jsonb,
  at              timestamptz not null default now()
);

create index if not exists reservation_events_by_reservation
  on public.reservation_events(reservation_id, at);

alter table public.reservation_events enable row level security;

create policy "reservation_events owner read"
  on public.reservation_events for select
  to authenticated
  using (
    exists (
      select 1 from public.reservations r
      where r.id = reservation_events.reservation_id
        and r.user_id = auth.jwt() ->> 'sub'
    )
  );

------------------------------------------------------------
-- user_reservation_locks: time-locks from tier abuse + payment fail
------------------------------------------------------------
do $$ begin
  create type lock_reason as enum (
    'tier_24h',
    'tier_7d',
    'manual_review',
    'payment_failed'
  );
exception when duplicate_object then null; end $$;

create table if not exists public.user_reservation_locks (
  user_id          text primary key,
  locked_until     timestamptz not null,
  reason           lock_reason not null,
  triggered_by_id  uuid references public.reservations(id),
  created_at       timestamptz not null default now()
);

alter table public.user_reservation_locks enable row level security;

create policy "user_reservation_locks owner read"
  on public.user_reservation_locks for select
  to authenticated
  using (user_id = auth.jwt() ->> 'sub');

------------------------------------------------------------
-- terms_acceptances: gate the first-time slide deck
------------------------------------------------------------
create table if not exists public.terms_acceptances (
  user_id        text not null,
  terms_version  int  not null,
  accepted_at    timestamptz not null default now(),
  app_version    text,
  ip             inet,
  primary key (user_id, terms_version)
);

alter table public.terms_acceptances enable row level security;

create policy "terms_acceptances owner read"
  on public.terms_acceptances for select
  to authenticated
  using (user_id = auth.jwt() ->> 'sub');

------------------------------------------------------------
-- get_my_reservation_state(): one round-trip hydrate for the client
-- Returns: { active, recent[], lock, terms_version_required,
--           terms_version_accepted, hold_amount_try }
------------------------------------------------------------
create or replace function public.get_my_reservation_state()
returns jsonb
language plpgsql
stable
security invoker
as $$
declare
  uid          text := auth.jwt() ->> 'sub';
  active_row   jsonb;
  recent_rows  jsonb;
  lock_row     jsonb;
  terms_v      int;
  cfg_terms    int;
  cfg_hold     int;
begin
  if uid is null then
    return jsonb_build_object('error', 'unauthenticated');
  end if;

  select to_jsonb(r) into active_row
    from public.reservations r
    where r.user_id = uid and r.status = 'active'
    limit 1;

  select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) into recent_rows
    from (
      select * from public.reservations
      where user_id = uid and status <> 'active'
      order by created_at desc
      limit 10
    ) r;

  select to_jsonb(l) into lock_row
    from public.user_reservation_locks l
    where l.user_id = uid
      and (l.locked_until > now() or l.locked_until = 'infinity'::timestamptz)
    limit 1;

  select max(terms_version) into terms_v
    from public.terms_acceptances
    where user_id = uid;

  select (value)::int into cfg_terms from public.app_config where key = 'terms_version';
  select (value)::int into cfg_hold  from public.app_config where key = 'reservation_hold_try';

  return jsonb_build_object(
    'active', active_row,
    'recent', recent_rows,
    'lock', lock_row,
    'terms_version_required', cfg_terms,
    'terms_version_accepted', terms_v,
    'hold_amount_try', cfg_hold
  );
end $$;

grant execute on function public.get_my_reservation_state() to authenticated;
