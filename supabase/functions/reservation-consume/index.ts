// @ts-nocheck — Deno runtime
//
// reservation-consume
// Called by the QR-scan flow when the user successfully scans the gate
// they had reserved. Releases the reservation hold (the session's own
// pre-auth takes over) and marks the reservation `consumed`.
//
// The caller MUST pass the station_id and gate_id from the scanned QR so
// we can verify it matches the reservation — specific-gate model means
// scanning a different gate must NOT consume the reservation.
//
// Request:  { reservation_id, station_id, gate_id }
// Success:  { ok: true, reservation_id }
// Errors:
//   401 unauthorized
//   400 bad_request
//   404 not_found
//   409 not_active | gate_mismatch
//   410 expired
//   500 service_role_missing | iyzico_not_configured | no_hold

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.47.10';
import { handleOptions, json } from '../_shared/cors.ts';
import { getBearerToken, getUserIdFromRequest } from '../_shared/auth.ts';
import { cancel as iyzicoRelease, checkEnv } from '../_shared/iyzico.ts';
import { logEvent } from '../_shared/reservations.ts';

type Input = {
  reservation_id: string;
  station_id: string;
  gate_id: string;
};

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
  if (!input.reservation_id || !input.station_id || !input.gate_id) {
    return json({ ok: false, error: 'bad_request' }, 400);
  }

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
  if (r.station_id !== input.station_id || r.gate_id !== input.gate_id) {
    return json(
      {
        ok: false,
        error: 'gate_mismatch',
        expected: { station_id: r.station_id, gate_id: r.gate_id },
      },
      409,
    );
  }
  if (new Date(r.expires_at).getTime() <= Date.now()) {
    return json({ ok: false, error: 'expired' }, 410);
  }
  if (!r.hold_id) return json({ ok: false, error: 'no_hold' }, 500);

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || '0.0.0.0';
  const iyz = await iyzicoRelease({
    locale: 'tr',
    conversationId: `consume:${r.id}`,
    paymentId: r.hold_id,
    ip,
  });
  // Release failure is non-blocking — the hold will eventually fall off
  // Iyzico's books, and we can't refuse the user a session they earned.
  if (iyz.status !== 'success') {
    console.warn('[reservation-consume] release failed (non-blocking)', { userId, iyz });
  }

  await supabaseAdmin
    .from('reservations')
    .update({ status: 'consumed', terminal_at: new Date().toISOString() })
    .eq('id', r.id);

  await logEvent(supabaseAdmin, r.id, 'consumed', {
    iyzico_release_status: iyz.status,
    iyzico_error: iyz.errorMessage,
  });

  return json({ ok: true, reservation_id: r.id });
});
