-- feedback: single table for both session-end ratings (`kind='session'`)
-- and any future "rate the app" prompts (`kind='app'`).
--
-- The bad-feedback modal opens when a user picks 😡 or 😕 (rating 0..1)
-- and posts:
--   - rating       always (so we get the signal even if they skip the modal)
--   - reasons      multi-select quick-picks (jsonb array of i18n keys)
--   - message      optional free-text
--
-- Owner-only RLS: users see + write their own rows. Service role (used by
-- internal dashboards / weekly digests) bypasses RLS as usual.

create table if not exists public.feedback (
  id          uuid primary key default gen_random_uuid(),
  user_id     text not null,
  kind        text not null check (kind in ('session', 'app')),
  session_id  uuid,
  rating      int  not null check (rating between 0 and 4),
  reasons     jsonb,
  message     text,
  app_version text,
  created_at  timestamptz not null default now()
);

create index if not exists feedback_user_recent
  on public.feedback(user_id, created_at desc);

create index if not exists feedback_kind_rating
  on public.feedback(kind, rating, created_at desc);

alter table public.feedback enable row level security;

create policy "feedback owner read"
  on public.feedback for select
  to authenticated
  using (user_id = auth.jwt() ->> 'sub');

create policy "feedback owner insert"
  on public.feedback for insert
  to authenticated
  with check (user_id = auth.jwt() ->> 'sub');
