# Operator runbook (Supabase Studio)

**Audience:** the 2 admins (canberk + utku) running ops until we hire support.

**Where:** Supabase Dashboard → SQL Editor. Save each block as a named query so
it's one click next time. Both admins already have Owner access.

Five operator functions live in [supabase/migrations/20260427120000_operator_functions.sql](../../supabase/migrations/20260427120000_operator_functions.sql)
and drive the ops below — type the user's phone, the function does the rest.
No more uuid copy-paste.

---

## 1. Find a user's current state

```sql
select * from public.op_find_user('+9055xxxxxxxx');   -- ← edit me
```

Returns one row with: user_id, phone, signed_up_at, active_reservation_id (or
null), station / sport / gate / expires_at / hold_id of that reservation,
lock_reason + locked_until.

Empty → phone isn't registered. Active reservation null → user has nothing
locked. Lock reason non-null → user is currently blocked from new reservations.

---

## 2. View a user's recent reservations

Default last 5; pass a second arg for more.

```sql
select * from public.op_recent_reservations('+9055xxxxxxxx');           -- last 5
select * from public.op_recent_reservations('+9055xxxxxxxx', 20);       -- last 20
```

---

## 3. View a reservation's full audit trail

Pass the `reservation_id` from #1 or #2.

```sql
select * from public.op_view_audit('a1b2c3d4-1234-5678-90ab-fedcba987654');
```

Read top-down: `created` → terminal event (`consumed`, `grace_cancel`,
`expired_capture_ok`, etc.) → any `tier_lock_triggered` or
`admin_lock_cleared` rows.

---

## 4. Force-release a stuck reservation (gate jam, hardware fault)

This finds the active reservation by phone, calls
`reservation-force-release`, releases the Iyzico hold (NOT captured),
moves the row to `expired_released`, and fires the "sistemden kaynaklı
sorun" push to the user.

```sql
select public.op_force_release(
  '+9055xxxxxxxx',                              -- ← user's phone
  'gate jam at ist-taksim-football-2'           -- ← reason, free text
);
```

Returns `{ok: true, reservation_id, request_id, ...}` if dispatched.

Confirm the Edge Function actually returned 200:

```sql
select status_code, content
from net._http_response
order by id desc limit 1;
```

Expect `200` and `{"ok":true,"status":"expired_released",...}`.

---

## 5. Clear a user's lock (payment_failed / manual_review)

Use sparingly — these locks exist for a reason. Acceptable triggers:

- **payment_failed**: capture has been confirmed in the Iyzico merchant
  dashboard out-of-band.
- **manual_review**: support has reviewed the case and is unblocking on
  a one-time basis.

```sql
select public.op_clear_lock(
  '+9055xxxxxxxx',                              -- ← user's phone
  'canberk',                                    -- ← who's clearing it
  'iyzico capture confirmed manually'           -- ← why (audit trail)
);
```

Returns `{ok: true, cleared_lock: 'payment_failed' | 'tier_24h' | ...}`.
Drops the row from `user_reservation_locks` AND writes an
`admin_lock_cleared` event on the user's most recent reservation, so the
audit trail survives.

---

## Common scenarios → which function

| Situation | Run |
|---|---|
| User says "the gate didn't open" | `op_find_user` to confirm an active reservation, then `op_force_release` with reason "gate jam at ..." |
| User says "I was charged ₺20 but I was there" | `op_find_user` → `op_view_audit` to confirm `expired_capture_ok`. If hardware actually failed, refund manually in Iyzico merchant dashboard, then `op_clear_lock` (which also leaves the audit breadcrumb) |
| User says "I can't reserve, says my card failed" | `op_find_user` to confirm `payment_failed` lock. Tell user to update card via /card-add. Retry-capture happens automatically. If it doesn't auto-clear in 5 min, `op_clear_lock` |
| User says "I'm permanently blocked" | `op_find_user` to confirm `manual_review` lock. `op_recent_reservations` to read their abuse pattern. If the case warrants unlocking, `op_clear_lock` |
| Gate physically broken at a station | Doesn't go through this runbook — set `availableNow: false` in `data/stations.seed.ts` and ship a config update |

---

## Setup once per admin (5 min)

1. Open [Dashboard → SQL Editor](https://supabase.com/dashboard/project/ucyjbvajmrwermytyuik/sql/new).
2. Paste each block above (one at a time), click **Save**, name them with the
   `op:` prefix:
   - `op: find user`
   - `op: recent reservations`
   - `op: view audit`
   - `op: force release`
   - `op: clear lock`
3. Done — the saved-queries sidebar groups everything by prefix.

To share with Utku: Dashboard → Settings → Team Members → Invite by email
(personal Gmail is fine; we don't use a work-domain restriction). Role:
**Developer**. Saved queries are project-scoped, so he sees them automatically.

---

## When to graduate from this approach

Stay here until ANY of:

- Daily op count > 5/day (copy-paste fatigue)
- A non-engineer joins support
- You want SLA-grade audit trails (Supabase Studio doesn't log who ran what)
- You want approvals / two-person sign-off on `op_clear_lock` for
  manual_review cases

When that happens, move to **Retool**: same backend, real admin UI, free
tier covers 5 seats, personal Gmail signup. The functions in this doc
become Retool buttons one-to-one — no rewriting.
