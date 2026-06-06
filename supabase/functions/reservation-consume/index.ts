// @ts-nocheck — Deno runtime
//
// reservation-consume
// Called by the QR-scan flow when the user successfully scans the gate
// they had reserved. Marks the reservation `consumed`.
//
// KEEP-ONE-HOLD-LIVE MODEL: the single deposit pre-auth placed at
// reservation-create stays LIVE through consume -> session -> return.
// Consume does NOT void the hold anymore. The same hold that served as the
// no-show guarantee now serves as the in-session deposit (the user showed up
// AND is using equipment, so the deposit stays held). Settlement resolves it
// later based on the session outcome:
//   gate_closed -> release_eligible_at -> settlement RELEASE
//   abandoned   -> penalty_eligible_at -> settlement CAPTURE
//   late return -> reversal_eligible_at -> settlement REFUND
// This replaces the old void-at-consume behavior.
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
import { checkEnv } from '../_shared/iyzico.ts';
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

  // KEEP-ONE-HOLD-LIVE: do NOT void the deposit hold here. The pre-auth on
  // r.hold_id placed at reservation-create stays live through the session and is
  // resolved later by the settlement function (release on return, capture on
  // abandon, refund on late return). This deliberately removes the old
  // iyzico cancel/void call that ran at consume.
  //
  // deposit_state is intentionally left untouched so it stays 'held' (its
  // create-time default); settlement moves it to a terminal state.
  await supabaseAdmin
    .from('reservations')
    .update({ status: 'consumed', terminal_at: new Date().toISOString() })
    .eq('id', r.id);

  await logEvent(supabaseAdmin, r.id, 'consumed', {
    deposit_hold_kept_live: true,
    note: 'deposit hold remains live for in-session settlement (release/capture/refund)',
  });

  return json({ ok: true, reservation_id: r.id });
});
