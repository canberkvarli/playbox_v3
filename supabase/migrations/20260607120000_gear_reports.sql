-- gear_reports + return-photos storage bucket
-- =============================================
--
-- gear_reports: user-filed reports for the photo-on-return + lost-gear
-- feature. When a user returns equipment (or can't), they may file a report
-- that something is lost / damaged / the wrong item was in the gate, etc.
-- Ops triages these from an internal queue (service role, which bypasses RLS).
--
-- return-photos: private storage bucket holding the photo a user snaps at
-- return time. Objects are namespaced per user so RLS can scope access to the
-- owner. Path convention:
--
--     return-photos/<user_id>/<ble_session_id>.jpg
--
-- where <user_id> is the Clerk JWT `sub` (same identity used everywhere else),
-- so the first path segment == the caller's user id under RLS.
--
-- Owner-only RLS model (mirrors public.feedback):
--   * authenticated users may INSERT + SELECT only their OWN rows / objects,
--     matched on `user_id = auth.jwt() ->> 'sub'` (the Clerk user id).
--   * the service role bypasses RLS as usual (ops queue, internal dashboards).
-- The bucket is PRIVATE (public = false); reads go through signed URLs / RLS.

-- ---------------------------------------------------------------------------
-- Table: public.gear_reports
-- ---------------------------------------------------------------------------

create table if not exists public.gear_reports (
  id             uuid primary key default gen_random_uuid(),
  user_id        text not null,                                              -- Supabase/Clerk JWT `sub` (matches public.feedback.user_id)
  ble_session_id text,                                                       -- BLE return session this report is tied to
  station_id     text,                                                       -- e.g. 'ist-taksim'
  gate           int,                                                        -- gate number within the station
  kind           text not null check (kind in ('lost', 'damaged', 'wrong_item', 'other')),
  message        text,                                                       -- optional free-text from the user
  photo_path     text,                                                       -- storage path in return-photos: <user_id>/<ble_session_id>.jpg
  status         text not null default 'open' check (status in ('open', 'reviewing', 'resolved')),
  created_at     timestamptz not null default now()
);

-- Ops queue: scan open reports oldest-first.
create index if not exists gear_reports_status_created
  on public.gear_reports(status, created_at);

-- Lookup all reports for a given BLE return session.
create index if not exists gear_reports_ble_session
  on public.gear_reports(ble_session_id);

alter table public.gear_reports enable row level security;

-- Owner-only RLS, identical identity expression to public.feedback.
drop policy if exists "gear_reports owner read" on public.gear_reports;
create policy "gear_reports owner read"
  on public.gear_reports for select
  to authenticated
  using (user_id = auth.jwt() ->> 'sub');

drop policy if exists "gear_reports owner insert" on public.gear_reports;
create policy "gear_reports owner insert"
  on public.gear_reports for insert
  to authenticated
  with check (user_id = auth.jwt() ->> 'sub');

-- ---------------------------------------------------------------------------
-- Storage: private return-photos bucket
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('return-photos', 'return-photos', false)
on conflict (id) do nothing;

-- Storage RLS: objects are namespaced as return-photos/<user_id>/...
-- A user may write + read only objects whose first path segment is their own
-- user id (auth.jwt() ->> 'sub'). service_role bypasses RLS for ops review.

drop policy if exists "return-photos owner read" on storage.objects;
create policy "return-photos owner read"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'return-photos'
    and (storage.foldername(name))[1] = (auth.jwt() ->> 'sub')
  );

drop policy if exists "return-photos owner insert" on storage.objects;
create policy "return-photos owner insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'return-photos'
    and (storage.foldername(name))[1] = (auth.jwt() ->> 'sub')
  );
