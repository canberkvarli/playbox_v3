// @ts-nocheck — Deno runtime
//
// reservation-force-release  (operator / station-hardware only)
//
// Releases a reservation's hold without charging the user. Used when a
// station-side fault (gate jam, hardware offline, station de-listed)
// makes it impossible for the user to use what they reserved. We must
// NOT charge them in that case, and they should be told.
//
// Auth: service-role JWT only. Any user-JWT call is rejected with 403,
// because this bypasses tier counters and the wallet penalty entirely.
// In practice, it's called from:
//   - the operator dashboard (server-to-server)
//   - station-hardware telemetry pipelines (also server-to-server)
//
// Request:  { reservation_id, reason? }
// Success:  { ok: true, status: 'expired_released' }
// Errors:
//   401 unauthorized        (no JWT)
//   403 forbidden           (user JWT, not service_role)
//   400 bad_request
//   404 not_found
//   409 not_active
//   500 service_role_missing | iyzico_not_configured | no_hold

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.47.10';
import { handleOptions, json } from '../_shared/cors.ts';
import { getRoleFromRequest } from '../_shared/auth.ts';
import { cancel as iyzicoRelease, checkEnv } from '../_shared/iyzico.ts';
import { logEvent } from '../_shared/reservations.ts';
import { sendPush } from '../_shared/push.ts';

type Input = { reservation_id: string; reason?: string };

Deno.serve(async (req) => {
  const opt = handleOptions(req);
  if (opt) return opt;

  const envCheck = checkEnv();
  if (!envCheck.ok) return json({ ok: false, error: 'iyzico_not_configured' }, 500);

  const role = getRoleFromRequest(req);
  if (!role) return json({ ok: false, error: 'unauthorized' }, 401);
  if (role !== 'service_role') return json({ ok: false, error: 'forbidden' }, 403);

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
    .maybeSingle();

  if (!r) return json({ ok: false, error: 'not_found' }, 404);
  if (r.status !== 'active') {
    return json({ ok: false, error: 'not_active', status: r.status }, 409);
  }

  // Release the hold. If iyzico fails, still mark released — the operator
  // already decided this row should not be charged.
  let releaseStatus: string | null = null;
  let releaseError: string | undefined;
  if (r.hold_id) {
    const iyz = await iyzicoRelease({
      locale: 'tr',
      conversationId: `force-release:${r.id}`,
      paymentId: r.hold_id,
      ip: '0.0.0.0',
    });
    releaseStatus = iyz.status;
    releaseError = iyz.errorMessage;
    if (iyz.status !== 'success') {
      console.warn('[reservation-force-release] iyzico release failed', {
        reservationId: r.id,
        iyz,
      });
    }
  }

  await supabaseAdmin
    .from('reservations')
    .update({ status: 'expired_released', terminal_at: new Date().toISOString() })
    .eq('id', r.id);

  await logEvent(supabaseAdmin, r.id, 'system_fault_release', {
    reason: input.reason ?? 'unspecified',
    iyzico_release_status: releaseStatus,
    iyzico_release_error: releaseError,
  });

  await sendPush(supabaseAdmin, r.user_id, {
    title: 'rezervasyonun iptal edildi',
    body: 'sistemden kaynaklı bir sorun oldu. ücret alınmadı.',
    data: { kind: 'reservation_released', reservation_id: r.id, reason: input.reason ?? null },
  });

  return json({ ok: true, status: 'expired_released' });
});
