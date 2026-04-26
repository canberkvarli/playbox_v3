// @ts-nocheck — Deno runtime
//
// reservation-sweep
// Captures expired-active reservations. Two operating modes:
//
//   - service-role JWT (pg_cron):  sweep up to 200 expired rows across
//     all users in one invocation.
//   - user JWT (lazy sweep):       sweep up to 5 expired rows belonging
//     to the caller. Defends against pg_cron lag.
//
// Per-row work is identical: try to capture the Iyzico hold, mark the
// row expired_captured, log the event, and run tier-lock evaluation. On
// capture failure, apply the payment_failed lock with locked_until=infinity.
//
// Idempotent — re-running the sweep on a row that's already terminal is a
// no-op because the query selects only status='active'.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.47.10';
import { handleOptions, json } from '../_shared/cors.ts';
import { getRoleFromRequest, getUserIdFromRequest } from '../_shared/auth.ts';
import { checkEnv, postauth as iyzicoCapture } from '../_shared/iyzico.ts';
import { applyTierLockIfNeeded, getAppConfig, logEvent } from '../_shared/reservations.ts';
import { sendPush } from '../_shared/push.ts';

Deno.serve(async (req) => {
  const opt = handleOptions(req);
  if (opt) return opt;

  const envCheck = checkEnv();
  if (!envCheck.ok) return json({ ok: false, error: 'iyzico_not_configured' }, 500);

  const role = getRoleFromRequest(req);
  const userId = getUserIdFromRequest(req);
  const isServiceRole = role === 'service_role';

  if (!isServiceRole && !userId) {
    return json({ ok: false, error: 'unauthorized' }, 401);
  }

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!SERVICE_ROLE_KEY) return json({ ok: false, error: 'service_role_missing' }, 500);

  const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // ----- T-5 reminder pass -----
  // Find active reservations expiring in the next 5 minutes that haven't
  // already been reminded. Cheap loop — just sends a push, no iyzico.
  const fiveMinFromNow = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  let t5Query = supabaseAdmin
    .from('reservations')
    .select('id, user_id, hold_amount_try, expires_at')
    .eq('status', 'active')
    .is('t5_notified_at', null)
    .gt('expires_at', new Date().toISOString())
    .lte('expires_at', fiveMinFromNow)
    .limit(isServiceRole ? 200 : 5);
  if (!isServiceRole) {
    t5Query = t5Query.eq('user_id', userId);
  }
  const { data: t5Rows } = await t5Query;
  let t5Sent = 0;
  for (const r of t5Rows ?? []) {
    await supabaseAdmin
      .from('reservations')
      .update({ t5_notified_at: new Date().toISOString() })
      .eq('id', r.id);
    await sendPush(supabaseAdmin, r.user_id, {
      title: '5 dakikan kaldı',
      body: 'rezervasyonun yakında düşecek. istasyona geldin mi?',
      data: { kind: 'reservation_t5', reservation_id: r.id },
    });
    t5Sent++;
  }

  // ----- Expired-capture pass -----
  let query = supabaseAdmin
    .from('reservations')
    .select('*')
    .eq('status', 'active')
    .lte('expires_at', new Date().toISOString())
    .limit(isServiceRole ? 200 : 5);
  if (!isServiceRole) {
    query = query.eq('user_id', userId);
  }

  const { data: rows, error: queryErr } = await query;
  if (queryErr) {
    console.error('[reservation-sweep] query failed', queryErr);
    return json({ ok: false, error: 'query_failed' }, 500);
  }

  if (!rows || rows.length === 0) {
    return json({
      ok: true,
      swept: 0,
      t5_sent: t5Sent,
      mode: isServiceRole ? 'cron' : 'user',
    });
  }

  const cfg = await getAppConfig(supabaseAdmin);
  let captured = 0;
  let captureFailed = 0;
  let systemFault = 0;

  for (const r of rows) {
    if (!r.hold_id) {
      // No hold to capture — release path. Shouldn't happen in normal flow
      // (create only inserts after preauth succeeds) but stay defensive.
      await supabaseAdmin
        .from('reservations')
        .update({ status: 'expired_released', terminal_at: new Date().toISOString() })
        .eq('id', r.id);
      await logEvent(supabaseAdmin, r.id, 'system_fault_release_no_hold', null);
      systemFault++;
      continue;
    }

    const price = Number(r.hold_amount_try).toFixed(2);
    const iyz = await iyzicoCapture({
      locale: 'tr',
      conversationId: `sweep:${r.id}`,
      paymentId: r.hold_id,
      paidPrice: price,
      ip: '0.0.0.0',
      currency: 'TRY',
      installment: 1,
    });

    if (iyz.status === 'success') {
      await supabaseAdmin
        .from('reservations')
        .update({ status: 'expired_captured', terminal_at: new Date().toISOString() })
        .eq('id', r.id);
      await logEvent(supabaseAdmin, r.id, 'expired_capture_ok', {
        hold_amount_try: r.hold_amount_try,
      });
      const lockReason = await applyTierLockIfNeeded(supabaseAdmin, r.user_id, cfg, r.id);
      await sendPush(supabaseAdmin, r.user_id, {
        title: `₺${r.hold_amount_try} tahsil edildi`,
        body: 'vaktinde gelmedin, bloke edilen tutar çekildi.',
        data: { kind: 'reservation_captured', reservation_id: r.id },
      });
      if (lockReason === 'tier_24h' || lockReason === 'tier_7d') {
        await sendPush(supabaseAdmin, r.user_id, {
          title: 'rezervasyon kilidi',
          body: 'birkaç rezervasyonunu kaçırdın. yeni rezervasyon bir süre açılmayacak.',
          data: { kind: 'reservation_tier_lock', reason: lockReason },
        });
      }
      captured++;
    } else {
      await supabaseAdmin
        .from('reservations')
        .update({ status: 'expired_captured', terminal_at: new Date().toISOString() })
        .eq('id', r.id);
      await logEvent(supabaseAdmin, r.id, 'expired_capture_fail', {
        iyzico_status: iyz.status,
        iyzico_error: iyz.errorMessage,
      });
      await supabaseAdmin.from('user_reservation_locks').upsert(
        {
          user_id: r.user_id,
          reason: 'payment_failed',
          locked_until: 'infinity',
          triggered_by_id: r.id,
          created_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' },
      );
      await sendPush(supabaseAdmin, r.user_id, {
        title: 'ücret çekilemedi',
        body: 'geçmiş rezervasyon ücreti kartından alınamadı. kartını güncelle.',
        data: { kind: 'reservation_capture_failed', reservation_id: r.id },
      });
      captureFailed++;
    }
  }

  return json({
    ok: true,
    swept: rows.length,
    captured,
    capture_failed: captureFailed,
    system_fault: systemFault,
    t5_sent: t5Sent,
    mode: isServiceRole ? 'cron' : 'user',
  });
});
