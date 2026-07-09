-- Marketing-site lead capture for playbox-web (waitlist + sponsor forms).
-- Two tables, RLS enabled. The public/anon role may INSERT (form submissions)
-- but has NO read access — leads are only visible via the dashboard/service role.

create table if not exists public.waitlist_signups (
  id         uuid primary key default gen_random_uuid(),
  email      text not null unique,
  source     text,
  ip         text,
  created_at timestamptz not null default now()
);

create table if not exists public.sponsor_inquiries (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  company    text not null,
  email      text not null,
  message    text,
  ip         text,
  created_at timestamptz not null default now()
);

alter table public.waitlist_signups  enable row level security;
alter table public.sponsor_inquiries enable row level security;

-- Insert-only for anon + authenticated. No SELECT/UPDATE/DELETE policies, so
-- RLS blocks all reads for those roles; the service role (dashboard) bypasses RLS.
drop policy if exists "web can insert waitlist" on public.waitlist_signups;
create policy "web can insert waitlist" on public.waitlist_signups
  for insert to anon, authenticated with check (true);

drop policy if exists "web can insert sponsor" on public.sponsor_inquiries;
create policy "web can insert sponsor" on public.sponsor_inquiries
  for insert to anon, authenticated with check (true);
