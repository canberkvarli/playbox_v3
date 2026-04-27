-- phone_attempts: audit + soft throttle for SMS OTP sends.
--
-- Twilio Verify is metered per send (~₺2 each in TR). Without per-phone +
-- per-IP rate limiting, a bad actor can spam a target's phone with codes
-- (legitimate-looking SMS = social-engineering surface) AND drain your
-- Twilio balance.
--
-- The otp-precheck Edge Function reads + inserts into this table. RLS is
-- locked down — service role only, since the client is by definition
-- unauthenticated when requesting an OTP.
--
-- Retention: rows older than 30 days are deleted by the next pg_cron
-- sweep (or the lazy cleanup at the bottom of otp-precheck).

create table if not exists public.phone_attempts (
  id            bigserial primary key,
  phone_e164    text not null,
  ip            inet,
  attempted_at  timestamptz not null default now(),
  outcome       text not null check (outcome in ('sent', 'throttled_phone', 'throttled_ip', 'invalid'))
);

create index if not exists phone_attempts_by_phone
  on public.phone_attempts(phone_e164, attempted_at desc);

create index if not exists phone_attempts_by_ip
  on public.phone_attempts(ip, attempted_at desc);

alter table public.phone_attempts enable row level security;
-- No policies. Only service role inserts/reads.
