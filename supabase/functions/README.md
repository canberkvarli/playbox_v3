# Iyzico Edge Functions

Three functions handle the card-on-file flow. Nothing about the card goes to
the client after tokenization, and the merchant secret only lives here.

## Env vars (set on the Supabase project)

```
IYZICO_API_KEY       # "sandbox-xxx" for sandbox, plain key in prod
IYZICO_SECRET_KEY    # paired secret
IYZICO_BASE_URL      # https://sandbox-api.iyzipay.com  (sandbox)
                     # https://api.iyzipay.com          (prod)
```

Supabase auto-injects `SUPABASE_URL` and `SUPABASE_ANON_KEY`, no action needed.

## Clerk JWT template

The functions trust the `sub` claim of the incoming Bearer JWT and delegate
scoping to Postgres RLS (`auth.jwt()->>'sub'` on `user_cards`). This requires
the Clerk JWT template named `supabase` that the mobile app already uses
(see `lib/supabase.ts`). Configure the same Clerk JWT signing secret on the
Supabase project under Settings → API → JWT Secret.

## Migration

Run `supabase/migrations/20260422000000_user_cards.sql` once. It creates the
`user_cards` table with RLS and an `updated_at` trigger.

## Deploy

```
supabase functions deploy iyzico-register-card
supabase functions deploy iyzico-preauth
supabase functions deploy iyzico-capture-release
```

## Endpoints

### POST `/iyzico-register-card`
Body: `{ cardNumber, cardHolderName, expireMonth, expireYear, cvc }`
Response: `{ ok: true, last4, brand }` or `{ ok: false, error }`

Tokenizes via Iyzico `/cardstorage/card`. Stores `cardUserKey` + `cardToken`
in `user_cards`. If a row already exists for the user, reuses the same
`cardUserKey` so Iyzico attaches the new card to that customer.

### POST `/iyzico-preauth`
Body: `{ amountTry, conversationId }`
Response: `{ ok: true, holdId }` or `{ ok: false, error }`

Places a hold via Iyzico `/payment/preauth` using the stored card tokens.
`holdId` is the Iyzico `paymentId`. Client stashes it on the active session
and passes it back at session end.

### POST `/iyzico-capture-release`
Body: `{ holdId, action: 'release' | 'capture', amountTry? }`
Response: `{ ok: true }` or `{ ok: false, error }`

`release` → `/payment/cancel` (void the hold).
`capture` → `/payment/postauth` (capture up to the held amount).

## Late-return capture (server-side, not in this PR)

The mobile app currently always releases on the review screen. Capture on a
late return belongs to a Postgres cron (`pg_cron`) or a scheduled Edge Function
that scans active sessions past their deadline and calls
`iyzico-capture-release` with `action: 'capture'`.

## Sandbox test cards

Full list: https://docs.iyzico.com/en/test-cards

Everyday smoke test (Mastercard, force-success, 3DS-safe):

| Field | Value |
|---|---|
| Card number | `5528 7900 0000 0008` |
| Expiry      | `12/30`              |
| CVC         | `123`                |
| Holder      | anything             |

Useful failure cards:

| Purpose               | Card number           |
|-----------------------|-----------------------|
| Insufficient funds    | `4125 2600 0000 1745` |
| Do not honor          | `5406 6700 0000 0009` |
| Invalid transaction   | `4043 0800 0000 0036` |
| Stolen card           | `4043 0900 0000 0035` |

All test cards only work when `IYZICO_BASE_URL=https://sandbox-api.iyzipay.com`.
Switch to `https://api.iyzipay.com` for real cards in production.
