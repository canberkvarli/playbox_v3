-- play_sessions: one row per COMPLETED real play session, written by the client
-- when a session finishes (return flow finalizes). Replaces the hardcoded dummy
-- profile stats with real games / total minutes / streak / city rank.
--
-- Demo/review sessions (DEV-* stations, demoMode) are NEVER inserted — the
-- client no-ops recordPlaySession() in demo mode, so reviewers see a clean
-- first-time profile.
--
-- Safe to re-run: guarded with `if not exists` / `create or replace` throughout.
--
-- PRE-REQS: none beyond a standard Supabase project (auth schema + gen_random_uuid,
-- which pgcrypto/pgsql provide by default). Apply via `supabase db push` or by
-- pasting this file into the SQL editor. See docs/RUNBOOK_play_stats.md.

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------
create table if not exists public.play_sessions (
  id               uuid primary key default gen_random_uuid(),
  -- Default to auth.uid() so the client never has to send user_id; RLS also
  -- enforces it equals the caller (see insert policy below).
  user_id          uuid not null default auth.uid() references auth.users(id) on delete cascade,
  station_id       text not null,
  sport            text not null,
  duration_minutes int not null check (duration_minutes >= 0),
  started_at       timestamptz not null,
  ended_at         timestamptz not null default now(),
  created_at       timestamptz not null default now()
);

create index if not exists play_sessions_user_ended_idx
  on public.play_sessions (user_id, ended_at desc);
create index if not exists play_sessions_station_idx
  on public.play_sessions (station_id);

-- ---------------------------------------------------------------------------
-- RLS: a user may INSERT + SELECT only their own rows. No update/delete.
-- ---------------------------------------------------------------------------
alter table public.play_sessions enable row level security;

drop policy if exists play_sessions_insert_own on public.play_sessions;
create policy play_sessions_insert_own
  on public.play_sessions
  for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists play_sessions_select_own on public.play_sessions;
create policy play_sessions_select_own
  on public.play_sessions
  for select
  to authenticated
  using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- get_play_stats(): single-row aggregate for the CALLER (auth.uid()).
--
-- SECURITY DEFINER so the city-rank computation can aggregate total_minutes
-- across ALL users at the caller's city stations WITHOUT exposing any
-- individual rows (RLS on the table still hides other users' rows from direct
-- selects). The function only ever returns aggregates + the caller's own rank.
-- ---------------------------------------------------------------------------
create or replace function public.get_play_stats()
returns table (
  games              int,
  total_minutes      int,
  streak_days        int,
  city_rank          int,
  city_total_players int
)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  uid uuid := auth.uid();
  v_games int := 0;
  v_total_minutes int := 0;
  v_streak int := 0;
  v_rank int := null;
  v_players int := null;
  d date;
  today date := (now() at time zone 'Europe/Istanbul')::date;
begin
  if uid is null then
    return query select 0, 0, 0, null::int, null::int;
    return;
  end if;

  -- games + total minutes
  select count(*)::int, coalesce(sum(duration_minutes), 0)::int
    into v_games, v_total_minutes
  from public.play_sessions
  where user_id = uid;

  -- Current consecutive-day streak, in Europe/Istanbul, counting back from
  -- today over the distinct dates the user has a session. Today OR yesterday
  -- must be present or the streak is 0.
  if v_games > 0 then
    -- anchor: today if a session today, else yesterday if a session yesterday,
    -- else no active streak.
    if exists (
      select 1 from public.play_sessions
      where user_id = uid
        and (ended_at at time zone 'Europe/Istanbul')::date = today
    ) then
      d := today;
    elsif exists (
      select 1 from public.play_sessions
      where user_id = uid
        and (ended_at at time zone 'Europe/Istanbul')::date = today - 1
    ) then
      d := today - 1;
    else
      d := null;
    end if;

    while d is not null and exists (
      select 1 from public.play_sessions
      where user_id = uid
        and (ended_at at time zone 'Europe/Istanbul')::date = d
    ) loop
      v_streak := v_streak + 1;
      d := d - 1;
    end loop;
  end if;

  -- City rank: among all users who have any session at a station in the SAME
  -- city as the caller's own sessions, rank the caller by total minutes.
  -- If the caller plays across multiple cities, we rank them in EACH and take
  -- their best (min rank) city — simplest defensible "şehir sıran".
  if v_games > 0 then
    with my_cities as (
      select distinct s.city
      from public.play_sessions ps
      join public.stations s on s.id = ps.station_id
      where ps.user_id = uid
        and s.city is not null
    ),
    city_player_minutes as (
      select s.city, ps.user_id, sum(ps.duration_minutes) as mins
      from public.play_sessions ps
      join public.stations s on s.id = ps.station_id
      where s.city in (select city from my_cities)
      group by s.city, ps.user_id
    ),
    ranked as (
      select
        city,
        user_id,
        rank() over (partition by city order by mins desc) as rnk,
        count(*) over (partition by city) as players
      from city_player_minutes
    )
    select rnk, players
      into v_rank, v_players
    from ranked
    where user_id = uid
    order by rnk asc
    limit 1;
  end if;

  return query select
    coalesce(v_games, 0),
    coalesce(v_total_minutes, 0),
    coalesce(v_streak, 0),
    v_rank,
    v_players;
end;
$$;

grant execute on function public.get_play_stats() to authenticated;
