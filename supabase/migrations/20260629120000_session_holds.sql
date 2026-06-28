-- session_holds — server record of Path-B (session-prep) iyzico pre-auth holds.
--
-- WHY: the session-prep → session-review flow places an iyzico pre-auth via the
-- `iyzico-preauth` function and captures/releases it via `iyzico-capture-release`,
-- but until now NOTHING server-side recorded the hold. If the app was killed
-- between preauth and the session-review capture (or the capture/release fetch
-- failed silently), the hold stayed placed with nothing anywhere instructing a
-- capture or release — a frozen card until iyzico's own pre-auth expiry
-- (issuer-dependent, days–weeks). This table + the `session-hold-sweep` cron
-- close that orphan window.
--
-- DISTINCT from `reservations` (Path A, server-authoritative). A dedicated table
-- avoids the reservations unique partial indexes (which key on status='active' +
-- station/gate, concepts Path B lacks) and keeps the blast radius tiny.
--
-- Lifecycle: held → (captured | released). Terminal states are set by the
-- client's capture/release through `iyzico-capture-release`, or — if the client
-- never resolves it — by `session-hold-sweep` RELEASING it past a TTL. The sweep
-- only ever RELEASES (gives money back); it never captures a hold it can't tie
-- to a measured session.

create table if not exists public.session_holds (
  hold_id           text primary key,          -- iyzico paymentId
  hold_txn_id       text,                       -- iyzico paymentTransactionId (refund key; informational)
  user_id           text not null,
  amount_try        int  not null,
  state             text not null default 'held'
                      check (state in ('held', 'captured', 'released')),
  created_at        timestamptz not null default now(),
  settled_at        timestamptz,
  settled_by        text,                       -- 'client' | 'sweep' (audit: who drove it terminal)
  settle_attempts   int  not null default 0,
  settle_last_error text
);

-- The sweep scans only still-held rows, oldest first.
create index if not exists session_holds_orphan_idx
  on public.session_holds (created_at)
  where state = 'held';

-- Written ONLY by edge functions using the service-role key (which bypasses
-- RLS). Enable RLS with NO policies so anon/auth JWTs can neither read nor write
-- it directly — mirrors how the settlement-only columns are kept server-only.
alter table public.session_holds enable row level security;
