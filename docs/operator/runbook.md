# Operator runbook (Supabase Studio v1)

**Audience:** the 2 admins (canberk + utku) keeping reservations sane until we
graduate to a real dashboard.

**Where to run these:** Supabase Dashboard → SQL Editor. Save each block as a
named query so it's one click next time. Both admins already have Owner access
on the project, no extra invite needed.

> ⚠️ All four snippets touch live data. Read the comment block at the top of
> each before clicking Run. Always copy the user_id / reservation_id from the
> "find" snippet first; never paste a UUID typed by hand.

---

## 1. Find a user by phone → see their active reservation + lock state

Replace `+9055...` with the user's phone (E.164).

```sql
with u as (
  select id, phone, created_at
  from auth.users
  where phone = '+9055xxxxxxxx'   -- ← edit me
)
select
  u.id            as user_id,
  u.phone,
  u.created_at    as signed_up_at,
  r.id            as active_reservation_id,
  r.station_id,
  r.sport,
  r.gate_id,
  r.expires_at,
  r.hold_id,
  l.reason        as lock_reason,
  l.locked_until  as locked_until
from u
left join public.reservations r
  on r.user_id = u.id::text and r.status = 'active'
left join public.user_reservation_locks l
  on l.user_id = u.id::text;
```

If no rows: phone isn't registered. If `active_reservation_id` is null, the user
has no active reservation. If `lock_reason` is non-null, they're locked.

---

## 2. View a reservation's full audit trail

Replace `RES_UUID` with the reservation_id from snippet #1.

```sql
select kind, payload, at
from public.reservation_events
where reservation_id = 'RES_UUID'   -- ← edit me
order by at;
```

Read top-to-bottom. Sequence will be:
- `created` → reservation placed
- `consumed` / `grace_cancel` / `cancel_after_grace_captured` /
  `expired_capture_ok` / `expired_capture_fail` → terminal event
- Any `tier_lock_triggered` after captures

If you see `expired_capture_fail` followed by no retry, that's why a
`payment_failed` lock is on the user — see snippet #4.

---

## 3. Force-release a stuck reservation (gate jam, hardware fault)

This calls the `reservation-force-release` Edge Function so the Iyzico hold is
properly released (NOT captured), the row goes to `expired_released`, and a
"sistemden kaynaklı sorun" push fires to the user.

Replace `RES_UUID` and `REASON` (free text — gets stored in the audit log).

```sql
select net.http_post(
  url := (select decrypted_secret from vault.decrypted_secrets where name = 'sweep_url' limit 1)
         || '/../reservation-force-release',
  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key' limit 1)
  ),
  body := jsonb_build_object(
    'reservation_id', 'RES_UUID',                          -- ← edit me
    'reason', 'gate jam at ist-taksim-football-2'          -- ← edit me, free text
  )
);
```

If you don't want to mess with the URL concatenation, hardcode the function URL:

```sql
-- Cleaner version — just paste the full URL
select net.http_post(
  url := 'https://ucyjbvajmrwermytyuik.supabase.co/functions/v1/reservation-force-release',
  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key' limit 1)
  ),
  body := jsonb_build_object(
    'reservation_id', 'RES_UUID',
    'reason', 'gate jam at ist-taksim-football-2'
  )
);
```

Verify it landed (run ~5 seconds later):

```sql
select status_code, content
from net._http_response
order by id desc limit 1;
```

Expect `200` + `{"ok":true,...}`.

---

## 4. Clear a user's lock (payment_failed or manual_review)

Use sparingly — these locks exist for a reason. Acceptable triggers:

- **payment_failed**: user updated their card AND the retry-capture succeeded
  out-of-band, but the lock didn't auto-clear (rare race). Verify capture in
  Iyzico merchant dashboard before clearing.
- **manual_review**: support has reviewed the case and the user is good to
  reserve again.

Replace `USER_ID` with the user_id from snippet #1.

```sql
delete from public.user_reservation_locks
where user_id = 'USER_ID';      -- ← edit me, the auth.users.id::text

-- Audit: leave a breadcrumb in case anyone questions the unlock later.
-- (Find the user's most recent reservation_id from snippet #1's results.)
insert into public.reservation_events (reservation_id, kind, payload)
values (
  'MOST_RECENT_RES_UUID',       -- ← edit me
  'admin_lock_cleared',
  jsonb_build_object(
    'cleared_by', 'canberk',    -- ← edit me to whichever of you is doing this
    'reason', 'iyzico capture confirmed manually'
  )
);
```

---

## Common scenarios → which snippet

| Situation | Run |
|---|---|
| User says "the gate didn't open" | #1 to find the reservation, then #3 to force-release with reason "gate jam" |
| User says "I was charged ₺20 but I was there" | #1 → #2 to confirm `expired_capture_ok` is in the log → if hardware actually failed, refund manually in Iyzico merchant dashboard, then snippet #4 step 2 to log the refund |
| User says "I can't reserve, says my card failed" | #1 to confirm `payment_failed` lock exists. Tell user to update card via /card-add. The retry-capture happens automatically. If it doesn't auto-clear, #4. |
| User says "I'm permanently blocked" | #1 to confirm `manual_review` lock. Pull #2 to read their capture history (look for the abuse pattern). If the case warrants unlocking, #4. |
| Gate physically broken at a station | Doesn't go through this runbook — flag the station as `availableNow: false` in `data/stations.seed.ts` and ship a config update. |

---

## Future improvements (not now)

- **Wrap snippet #3 + #4 in plpgsql functions** so it's `select playbox_force_release('uuid','reason')` instead of pasting the http_post boilerplate.
- **Move to Retool** when the daily snippet runs hit > 5 / day or you onboard a non-engineer support person. Retool free tier covers up to ~5 admin seats, no work-email requirement (personal Gmail works).
- **Slack-bot integration** so support flows happen in chat: `/playbox release RES_UUID gate-jam` → bot calls the edge function → posts the result back. Worth it once op volume justifies the bot maintenance.
