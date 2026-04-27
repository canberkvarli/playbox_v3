-- Operator functions: thin wrappers around the runbook snippets so support
-- can drive everything by phone number instead of copy-pasting uuids.
--
-- All five functions are SECURITY DEFINER + locked to postgres / service_role
-- only, so they're invokable from Supabase Studio's SQL Editor (which runs
-- as postgres) but NOT from client JWTs.
--
-- Usage:
--   select * from public.op_find_user('+905551234567');
--   select * from public.op_recent_reservations('+905551234567');
--   select * from public.op_view_audit('a1b2...');
--   select public.op_force_release('+905551234567', 'gate jam at ist-taksim-fb-2');
--   select public.op_clear_lock('+905551234567', 'canberk', 'iyzico capture confirmed');

----------------------------------------------------------------
-- 1. op_find_user — current state for a user keyed by phone
----------------------------------------------------------------
create or replace function public.op_find_user(p_phone text)
returns table (
  user_id              text,
  phone                text,
  signed_up_at         timestamptz,
  active_reservation_id uuid,
  station_id           text,
  sport                text,
  gate_id              text,
  expires_at           timestamptz,
  hold_id              text,
  lock_reason          text,
  locked_until         timestamptz
)
language sql
security definer
set search_path = public, auth
as $$
  with u as (
    select id::text as id, phone, created_at
    from auth.users
    where phone = p_phone
  )
  select
    u.id,
    u.phone,
    u.created_at,
    r.id, r.station_id, r.sport, r.gate_id, r.expires_at, r.hold_id,
    l.reason::text, l.locked_until
  from u
  left join public.reservations r
    on r.user_id = u.id and r.status = 'active'
  left join public.user_reservation_locks l
    on l.user_id = u.id;
$$;
revoke all on function public.op_find_user(text) from public;
grant execute on function public.op_find_user(text) to postgres, service_role;

----------------------------------------------------------------
-- 2. op_recent_reservations — last N rows (any status) for a phone
----------------------------------------------------------------
create or replace function public.op_recent_reservations(p_phone text, p_limit int default 5)
returns table (
  reservation_id   uuid,
  status           text,
  station_id       text,
  sport            text,
  gate_id          text,
  hold_amount_try  int,
  created_at       timestamptz,
  terminal_at      timestamptz
)
language sql
security definer
set search_path = public, auth
as $$
  with u as (select id::text as id from auth.users where phone = p_phone)
  select r.id, r.status::text, r.station_id, r.sport, r.gate_id,
         r.hold_amount_try, r.created_at, r.terminal_at
  from public.reservations r, u
  where r.user_id = u.id
  order by r.created_at desc
  limit p_limit;
$$;
revoke all on function public.op_recent_reservations(text, int) from public;
grant execute on function public.op_recent_reservations(text, int) to postgres, service_role;

----------------------------------------------------------------
-- 3. op_view_audit — full event log for a reservation
----------------------------------------------------------------
create or replace function public.op_view_audit(p_reservation_id uuid)
returns table (
  kind     text,
  payload  jsonb,
  at       timestamptz
)
language sql
security definer
set search_path = public
as $$
  select kind, payload, at
  from public.reservation_events
  where reservation_id = p_reservation_id
  order by at;
$$;
revoke all on function public.op_view_audit(uuid) from public;
grant execute on function public.op_view_audit(uuid) to postgres, service_role;

----------------------------------------------------------------
-- 4. op_force_release — find active reservation by phone, fire the
--    reservation-force-release Edge Function. Hold is released (NOT
--    captured), row goes to expired_released, push fires to user.
----------------------------------------------------------------
create or replace function public.op_force_release(p_phone text, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, vault, net
as $$
declare
  v_user_id        text;
  v_reservation_id uuid;
  v_request_id     bigint;
  v_function_url   text := 'https://ucyjbvajmrwermytyuik.supabase.co/functions/v1/reservation-force-release';
  v_service_key    text;
begin
  select id::text into v_user_id from auth.users where phone = p_phone;
  if v_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'user_not_found');
  end if;

  select id into v_reservation_id
  from public.reservations
  where user_id = v_user_id and status = 'active'
  limit 1;
  if v_reservation_id is null then
    return jsonb_build_object(
      'ok', false, 'error', 'no_active_reservation', 'user_id', v_user_id
    );
  end if;

  select decrypted_secret into v_service_key
  from vault.decrypted_secrets where name = 'service_role_key' limit 1;
  if v_service_key is null then
    return jsonb_build_object('ok', false, 'error', 'vault_secret_missing');
  end if;

  select net.http_post(
    url := v_function_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_service_key
    ),
    body := jsonb_build_object(
      'reservation_id', v_reservation_id,
      'reason', coalesce(p_reason, 'operator force release')
    )
  ) into v_request_id;

  return jsonb_build_object(
    'ok', true,
    'reservation_id', v_reservation_id,
    'user_id', v_user_id,
    'request_id', v_request_id,
    'note', 'check net._http_response in ~5 sec for the function''s 200/4xx'
  );
end;
$$;
revoke all on function public.op_force_release(text, text) from public;
grant execute on function public.op_force_release(text, text) to postgres, service_role;

----------------------------------------------------------------
-- 5. op_clear_lock — wipe a user's lock + leave an audit breadcrumb
--    on their most recent reservation
----------------------------------------------------------------
create or replace function public.op_clear_lock(p_phone text, p_admin_name text, p_reason text default 'manual review')
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user_id        text;
  v_lock_reason    text;
  v_recent_res_id  uuid;
begin
  select id::text into v_user_id from auth.users where phone = p_phone;
  if v_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'user_not_found');
  end if;

  select reason::text into v_lock_reason
  from public.user_reservation_locks where user_id = v_user_id;
  if v_lock_reason is null then
    return jsonb_build_object('ok', false, 'error', 'no_active_lock', 'user_id', v_user_id);
  end if;

  select id into v_recent_res_id
  from public.reservations
  where user_id = v_user_id
  order by created_at desc limit 1;

  delete from public.user_reservation_locks where user_id = v_user_id;

  if v_recent_res_id is not null then
    insert into public.reservation_events (reservation_id, kind, payload)
    values (
      v_recent_res_id,
      'admin_lock_cleared',
      jsonb_build_object(
        'cleared_by', p_admin_name,
        'cleared_lock_reason', v_lock_reason,
        'note', p_reason
      )
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'user_id', v_user_id,
    'cleared_lock', v_lock_reason
  );
end;
$$;
revoke all on function public.op_clear_lock(text, text, text) from public;
grant execute on function public.op_clear_lock(text, text, text) to postgres, service_role;
