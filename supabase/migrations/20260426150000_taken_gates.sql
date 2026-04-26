-- taken_gates(station_id, sport): returns the gate_ids currently held by
-- ANYONE with an active reservation. The reservations table's RLS only lets
-- a user see their OWN rows, so the gate-picker UI cannot otherwise know
-- which gates a stranger has taken. This function is `security definer` and
-- returns ONLY gate_id strings — no user_id, no leakage.

create or replace function public.taken_gates(p_station_id text, p_sport text)
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(gate_id order by gate_id), '{}'::text[])
  from public.reservations
  where station_id = p_station_id
    and sport = p_sport
    and status = 'active';
$$;

grant execute on function public.taken_gates(text, text) to authenticated;
