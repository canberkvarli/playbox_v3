-- user_cards: one row per Clerk user, holds the Iyzico tokens we need to charge
-- them in the future. We never store the PAN or CVV.
create table if not exists public.user_cards (
  user_id              text primary key,
  iyzico_card_user_key text not null,
  iyzico_card_token    text not null,
  last4                text not null,
  brand                text not null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

alter table public.user_cards enable row level security;

-- The Clerk JWT template 'supabase' puts the Clerk user id in `sub`.
-- Only the owner can see or modify their own row.
create policy "user_cards owner read"
  on public.user_cards for select
  using (user_id = auth.jwt() ->> 'sub');

create policy "user_cards owner upsert"
  on public.user_cards for insert
  with check (user_id = auth.jwt() ->> 'sub');

create policy "user_cards owner update"
  on public.user_cards for update
  using (user_id = auth.jwt() ->> 'sub');

create policy "user_cards owner delete"
  on public.user_cards for delete
  using (user_id = auth.jwt() ->> 'sub');

create or replace function public.user_cards_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists user_cards_set_updated_at on public.user_cards;
create trigger user_cards_set_updated_at
  before update on public.user_cards
  for each row execute function public.user_cards_touch_updated_at();
