// @ts-nocheck — Deno runtime
//
// reservation-retry-capture
// Called by the client after the user updates their card and we want to
// retry the capture that originally failed and applied the payment_failed
// lock. On success: clear the lock, log capture_retry_ok. On failure:
// log capture_retry_fail, lock stays.
//
// Request:  { reservation_id }
// Success:  { ok: true, lock_cleared: true }
// Errors:
//   401 unauthorized
//   400 bad_request
//   404 not_found
//   409 wrong_status | no_payment_failed_lock
//   402 retry_failed
//   500 service_role_missing | iyzico_not_configured | no_hold

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.47.10';
import { handleOptions, json } from '../_shared/cors.ts';
import { getBearerToken, getUserIdFromRequest } from '../_shared/auth.ts';
import { checkEnv, postauth as iyzicoCapture } from '../_shared/iyzico.ts';
import { logEvent } from '../_shared/reservations.ts';

type Input = { reservation_id: string };

Deno.serve(async (req) => {
  const opt = handleOptions(req);
  if (opt) return opt;

  const envCheck = checkEnv();
  if (!envCheck.ok) return json({ ok: false, error: 'iyzico_not_configured' }, 500);

  const userId = getUserIdFromRequest(req);
  const jwt = getBearerToken(req);
  if (!userId || !jwt) return json({ ok: false, error: 'unauthorized' }, 401);

  let input: Input;
  try {
    input = await req.json();
  } catch {
    return json({ ok: false, error: 'bad_request' }, 400);
  }
  if (!input.reservation_id) return json({ ok: false, error: 'bad_request' }, 400);

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!SERVICE_ROLE_KEY) return json({ ok: false, error: 'service_role_missing' }, 500);

  const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const { data: r } = await supabaseAdmin
    .from('reservations')
    .select('*')
    .eq('id', input.reservation_id)
    .eq('user_id', userId)
    .maybeSingle();

  if (!r) return json({ ok: false, error: 'not_found' }, 404);
  if (r.status !== 'expired_captured') {
    return json({ ok: false, error: 'wrong_status', status: r.status }, 409);
  }
  if (!r.hold_id) return json({ ok: false, error: 'no_hold' }, 500);

  const { data: lock } = await supabaseAdmin
    .from('user_reservation_locks')
    .select('reason, triggered_by_id')
    .eq('user_id', userId)
    .maybeSingle();
  if (!lock || lock.reason !== 'payment_failed') {
    return json({ ok: false, error: 'no_payment_failed_lock' }, 409);
  }

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || '0.0.0.0';
  const price = Number(r.hold_amount_try).toFixed(2);
  const iyz = await iyzicoCapture({
    locale: 'tr',
    conversationId: `retry:${r.id}`,
    paymentId: r.hold_id,
    paidPrice: price,
    ip,
    currency: 'TRY',
    installment: 1,
  });

  if (iyz.status === 'success') {
    await supabaseAdmin.from('user_reservation_locks').delete().eq('user_id', userId);
    await logEvent(supabaseAdmin, r.id, 'capture_retry_ok', {
      hold_amount_try: r.hold_amount_try,
    });
    return json({ ok: true, lock_cleared: true });
  }

  await logEvent(supabaseAdmin, r.id, 'capture_retry_fail', {
    iyzico_status: iyz.status,
    iyzico_error: iyz.errorMessage,
  });
  return json({ ok: false, error: 'retry_failed', iyzico_error: iyz.errorMessage }, 402);
});
