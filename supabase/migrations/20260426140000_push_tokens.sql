-- user_push_tokens: stores the Expo push token per user.
-- Owner-write policies because the token is user-public; we don't need
-- the service role round-trip for registration.

create table if not exists public.user_push_tokens (
  user_id      text primary key,
  expo_token   text not null,
  device_info  jsonb,
  updated_at   timestamptz not null default now()
);

alter table public.user_push_tokens enable row level security;

create policy "user_push_tokens owner read"
  on public.user_push_tokens for select
  to authenticated
  using (user_id = auth.jwt() ->> 'sub');

create policy "user_push_tokens owner insert"
  on public.user_push_tokens for insert
  to authenticated
  with check (user_id = auth.jwt() ->> 'sub');

create policy "user_push_tokens owner update"
  on public.user_push_tokens for update
  to authenticated
  using (user_id = auth.jwt() ->> 'sub');

create policy "user_push_tokens owner delete"
  on public.user_push_tokens for delete
  to authenticated
  using (user_id = auth.jwt() ->> 'sub');

create or replace function public.user_push_tokens_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists user_push_tokens_set_updated_at on public.user_push_tokens;
create trigger user_push_tokens_set_updated_at
  before update on public.user_push_tokens
  for each row execute function public.user_push_tokens_touch_updated_at();
