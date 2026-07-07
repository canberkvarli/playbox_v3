-- reapable_return_photos: the photo-reap Edge Function cannot read storage.objects
-- via the JS client because the `storage` schema is NOT exposed to PostgREST /
-- the Data API. This SECURITY DEFINER function (owned by the migration role, which
-- can read storage.objects) does the cross-schema scan for it and, in the same
-- query, flags whether an OPEN/REVIEWING gear_report still pins the object (a live
-- dispute must keep its evidence).
--
-- It only READS + FILTERS; the actual delete still happens through the Storage
-- API in the Edge Function, and the pure shouldReapPhoto predicate stays the
-- single source of truth for the delete decision (this is the SQL pre-filter).

create or replace function public.reapable_return_photos(
  older_than timestamptz,
  lim int
)
returns table (
  name text,
  created_at timestamptz,
  has_live_dispute boolean
)
language sql
security definer
set search_path = public
as $$
  select
    o.name,
    o.created_at,
    exists (
      select 1
      from public.gear_reports g
      where g.photo_path = o.name
        and g.status in ('open', 'reviewing')
    ) as has_live_dispute
  from storage.objects o
  where o.bucket_id = 'return-photos'
    and o.created_at < older_than
    and o.name is not null
  order by o.created_at asc
  limit lim;
$$;

-- Ops-only: pg_cron invokes the Edge Function with the service role, which calls
-- this RPC. Never expose it to anon/authenticated (it enumerates every user's
-- object paths).
revoke all on function public.reapable_return_photos(timestamptz, int) from public, anon, authenticated;
grant execute on function public.reapable_return_photos(timestamptz, int) to service_role;
