// @ts-nocheck — Deno runtime
//
// reservation-cancel
// Cancels an active reservation. Within the 2-minute grace window the hold
// is released for free. After the grace window, the hold is captured (the
// user pays the no-show penalty) and tier counters are evaluated.
//
// Request:  { reservation_id }
// Success:  { ok: true, status: 'cancelled' | 'expired_captured', lock?: string }
// Errors:
//   401 unauthorized
//   400 bad_request
//   404 not_found
//   409 not_active
//   402 capture_failed   (after grace; user is hard-locked until card retry)
//   500 service_role_missing | iyzico_not_configured | no_hold

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.47.10';
import { handleOptions, json } from '../_shared/cors.ts';
import { getBearerToken, getUserIdFromRequest } from '../_shared/auth.ts';
import {
  cancel as iyzicoRelease,
  checkEnv,
  postauth as iyzicoCapture,
} from '../_shared/iyzico.ts';
import { applyTierLockIfNeeded, getAppConfig, logEvent } from '../_shared/reservations.ts';

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
  if (r.status !== 'active') {
    return json({ ok: false, error: 'not_active', status: r.status }, 409);
  }
  if (!r.hold_id) return json({ ok: false, error: 'no_hold' }, 500);

  const cfg = await getAppConfig(supabaseAdmin);
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || '0.0.0.0';
  const ageMs = Date.now() - new Date(r.created_at).getTime();
  const inGrace = ageMs <= cfg.grace_seconds * 1000;
  const conversationId = `cancel:${r.id}`;

  if (inGrace) {
    const iyz = await iyzicoRelease({
      locale: 'tr',
      conversationId,
      paymentId: r.hold_id,
      ip,
    });
    if (iyz.status !== 'success') {
      // Release failed — log it but still mark the row cancelled. The user
      // shouldn't be punished because Iyzico glitched on their cancel.
      console.warn('[reservation-cancel] grace release failed', { userId, iyz });
    }
    await supabaseAdmin
      .from('reservations')
      .update({ status: 'cancelled', terminal_at: new Date().toISOString() })
      .eq('id', r.id);
    await logEvent(supabaseAdmin, r.id, 'grace_cancel', {
      iyzico_status: iyz.status,
      iyzico_error: iyz.errorMessage,
    });
    return json({ ok: true, status: 'cancelled' });
  }

  // After grace — capture the hold.
  const price = Number(r.hold_amount_try).toFixed(2);
  const iyz = await iyzicoCapture({
    locale: 'tr',
    conversationId,
    paymentId: r.hold_id,
    paidPrice: price,
    ip,
    currency: 'TRY',
    installment: 1,
  });

  if (iyz.status !== 'success') {
    console.warn('[reservation-cancel] capture failed', { userId, iyz });
    await supabaseAdmin
      .from('reservations')
      .update({ status: 'expired_captured', terminal_at: new Date().toISOString() })
      .eq('id', r.id);
    await logEvent(supabaseAdmin, r.id, 'cancel_after_grace_capture_fail', {
      iyzico_status: iyz.status,
      iyzico_error: iyz.errorMessage,
    });
    await supabaseAdmin.from('user_reservation_locks').upsert(
      {
        user_id: userId,
        reason: 'payment_failed',
        locked_until: 'infinity',
        triggered_by_id: r.id,
        created_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' },
    );
    return json({ ok: false, error: 'capture_failed' }, 402);
  }

  await supabaseAdmin
    .from('reservations')
    .update({ status: 'expired_captured', terminal_at: new Date().toISOString() })
    .eq('id', r.id);
  await logEvent(supabaseAdmin, r.id, 'cancel_after_grace_captured', {
    hold_amount_try: r.hold_amount_try,
  });

  const lockReason = await applyTierLockIfNeeded(supabaseAdmin, userId, cfg, r.id);
  return json({ ok: true, status: 'expired_captured', lock: lockReason });
});
