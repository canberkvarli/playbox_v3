# Settlement live-run validation (iyzico SANDBOX)

Validate the deployed `settlement` edge function against the **iyzico sandbox**
once the code is shipped. The Jest suites (`settlement-decide`, `settlement-ids`,
`settlement-process`, `settlement-lifecycle`) already prove the pure decision +
orchestration logic with in-memory fakes — no Deno, no DB, no network. This is
the missing leg: confirming the real iyzico adapter actually moves sandbox money
in the three legs (release / capture / refund) and that `deposit_state` lands
correctly. It is intentionally a manual, write-once runbook (nothing here runs in
CI — `deno` / DB / iyzico are unavailable in the Jest environment).

> Money safety: run against the **sandbox** merchant only. Each leg moves real
> sandbox funds against a real sandbox preauth. Use throwaway test reservations.

---

## 0. Prerequisites

- Supabase CLI logged in + linked to the target project (`supabase link`).
- iyzico **sandbox** API key/secret and base URL.
- A sandbox **preauth (hold)** you can create on demand (the 3-D-secure-free
  test card flow) so you have a real `paymentId` + `paymentTransactionId`.

---

## 1. Apply the Phase-2 migrations

```bash
supabase db push           # or apply explicitly, in order:
# 20260606120000_*.sql     # deposit_state column + *_eligible_at flags + indexes
# 20260606130000_*.sql     # backfill: map legacy reservation rows -> deposit_state
```

Confirm the schema landed:

```sql
select column_name from information_schema.columns
 where table_name = 'reservations'
   and column_name in ('deposit_state','hold_id','hold_txn_id',
                       'release_eligible_at','penalty_eligible_at','reversal_eligible_at');
-- expect all six rows
```

---

## 2. Set env + the vault secret

iyzico adapter env (function secrets):

```bash
supabase secrets set \
  IYZICO_API_KEY=sandbox-xxxx \
  IYZICO_SECRET_KEY=sandbox-yyyy \
  IYZICO_BASE_URL=https://sandbox-api.iyzipay.com
```

The cron/db-trigger calls the function via a URL stored in Vault:

```sql
select vault.create_secret('https://<project-ref>.functions.supabase.co/settlement',
                           'settlement_url');
-- if it already exists, vault.update_secret(...)
```

---

## 3. Seed a reservation with a REAL sandbox preauth + a flag

3a. Create a sandbox preauth (hold) → capture the two refs from the response:
- `hold_id`     = iyzico `paymentId`
- `hold_txn_id` = iyzico `paymentTransactionId` (see GO-LIVE item (a) — it is
  typically nested under `itemTransactions[0].paymentTransactionId`).

3b. Insert (or update) one reservation per leg you want to exercise:

```sql
-- RELEASE leg (on-time return): held + release_eligible_at
update reservations set deposit_state='held', hold_id='<paymentId>',
  hold_txn_id='<paymentTransactionId>', release_eligible_at=now()
 where id='<res-release>';

-- CAPTURE leg (abandoned): held + penalty_eligible_at
update reservations set deposit_state='held', hold_id='<paymentId2>',
  hold_txn_id='<paymentTransactionId2>', penalty_eligible_at=now()
 where id='<res-capture>';

-- REFUND leg (late return after capture): captured + reversal_eligible_at,
-- penalty_eligible_at cleared (mirrors Phase-1 gate_closed late-return write)
update reservations set deposit_state='captured', hold_id='<paymentId3>',
  hold_txn_id='<paymentTransactionId3>',
  penalty_eligible_at=null, reversal_eligible_at=now()
 where id='<res-refund>';
```

---

## 4. Invoke the function

```bash
supabase functions invoke settlement --no-verify-jwt
# or hit the deployed URL the same way the cron does.
```

For the **multi-tick lifecycle** (the capture→refund reversal): invoke ONCE with
the capture row in `held + penalty_eligible_at`, confirm it captured, THEN run
the section-3b refund `update` to flip flags, THEN invoke AGAIN — confirm the
second invocation refunds and never re-captures (the live mirror of lifecycle
scenario 3).

---

## 5. Confirm the result

5a. In the **iyzico sandbox dashboard**, confirm the matching transaction per leg:
- release → the preauth is voided / cancelled (hold dropped, no capture).
- capture → the preauth is captured (funds settled).
- refund  → the captured amount is refunded back (net zero for that deposit).

5b. In the DB, confirm state + timestamp advanced exactly once:

```sql
select id, deposit_state, settled_at from reservations
 where id in ('<res-release>','<res-capture>','<res-refund>');
-- expect: released / captured (then refunded after the 2nd invoke) / refunded
-- settled_at set; re-invoking does NOT change deposit_state or call iyzico again.
```

5c. Confirm idempotency live: invoke a third time over the now-terminal rows →
no new iyzico transactions appear in the sandbox dashboard, `deposit_state`
unchanged. This is the live mirror of the cumulative-call-count assertions in
`settlement-lifecycle.test.ts`.

---

## GO-LIVE CHECKLIST (gathered across Phase 2)

Resolve each before flipping settlement to the production iyzico merchant:

- [ ] **(a) preauth `paymentTransactionId` surfaces** — verify the sandbox
  preauth response actually returns `paymentTransactionId` so `hold_txn_id` is
  populated (refund keys on it). It is commonly NESTED under
  `itemTransactions[].paymentTransactionId` rather than top-level — confirm the
  adapter reads it from the right place, otherwise refunds fail with
  `missing_payment_ref`.
- [ ] **(b) `/payment/refund` field names** — confirm the refund request field
  names (`paymentTransactionId`, `price`, `ip`, `locale`, `conversationId`)
  against the CURRENT iyzico v2 docs; v1/v2 differ. Mismatched names silently
  no-op or error.
- [ ] **(c) migration backfill mapping** — verify `20260606130000`'s legacy →
  `deposit_state` mapping against the REAL consume flow, especially
  `consumed -> released` (a consumed/returned ball must backfill to `released`,
  not leave a stale `held` that the sweep would later act on).
- [ ] **(d) multi-worker concurrency follow-up** — before scaling to >1
  settlement worker, add `FOR UPDATE SKIP LOCKED` (or a transient `settling`
  claim state) to `getCandidates` so two workers never pick the same row. Today,
  safety rests on the iyzico conversationId dedupe + the conditional
  `markSettled` lost-update guard; the lock removes the redundant second
  round-trip entirely.
