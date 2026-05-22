// @ts-nocheck — Deno runtime
//
// sign-unlock
// Returns an HMAC-signed BLE unlock payload that the phone relays directly
// to the station over BLE. The phone never sees the station secret.
//
// Why this is separate from `gate-unlock`:
//   - gate-unlock dispatches to a hardware bridge (network/MQTT) and is the
//     primary unlock path when the phone has internet.
//   - sign-unlock returns a *signed payload* the phone writes via BLE — used
//     when the station has no network connection but the phone does (e.g.
//     outdoor unit, weak cellular, captive WiFi). Same security guarantees:
//     active payment hold required, signature is bound to (gate, session_id,
//     duration_min, ts), firmware enforces monotonic ts to block replay.
//
// Required env:
//   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (autopopulated)
//   PLAYBOX_STATION_SECRET_DEV_001 — 64 hex chars (32 bytes), per station

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.47.10';
import { handleOptions, json } from '../_shared/cors.ts';
import { getBearerToken, getUserIdFromRequest } from '../_shared/auth.ts';
import { signUnlock, signReturnUnlock } from '../_shared/blesign.ts';

Deno.serve(async (req) => {
  const opt = handleOptions(req);
  if (opt) return opt;

  let body: {
    cmd?: 'unlock' | 'return_unlock';
    station_id?: string;
    gate?: number;
    session_id?: string;
    duration_min?: number;
    dev_bypass?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: 'bad_body' }, 400);
  }

  // Auth: required for normal use, optional for the DEV-001 dev panel.
  const userId = getUserIdFromRequest(req);
  const jwt = getBearerToken(req);
  const isDevBypass = body.dev_bypass === true && body.station_id === 'DEV-001';
  if (!isDevBypass && (!userId || !jwt)) {
    return json({ ok: false, error: 'unauthorized' }, 401);
  }

  const cmd = body.cmd ?? 'unlock';
  const { station_id, gate, session_id } = body;
  const duration_min = body.duration_min ?? 30;
  const dev_bypass = body.dev_bypass === true;

  if (!station_id || gate == null || !session_id) {
    return json({ ok: false, error: 'missing_params' }, 400);
  }
  if (cmd !== 'unlock' && cmd !== 'return_unlock') {
    return json({ ok: false, error: 'bad_cmd' }, 400);
  }

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!SERVICE_ROLE_KEY) return json({ ok: false, error: 'service_role_missing' }, 500);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // Dev bypass: skip the payment-hold gate for DEV-001 only, used by the
  // Force Unlock / Force Return buttons in the app for hardware smoke
  // testing. Limited to that one station ID so it can't be used to bypass
  // payment for any real station.
  const allowDevBypass = dev_bypass && station_id === 'DEV-001';

  if (!allowDevBypass) {
    // Same payment-hold check as gate-unlock — refuse to sign anything for a
    // user without an active iyzico preauth. Without this, BLE unlock would
    // bypass payment.
    const { data: hold, error: holdErr } = await admin
      .from('payment_holds')
      .select('id, station_id, captured_at, released_at')
      .eq('user_id', userId)
      .eq('station_id', station_id)
      .is('captured_at', null)
      .is('released_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (holdErr) console.error('[sign-unlock] hold lookup failed', holdErr);
    if (!hold) return json({ ok: false, error: 'no_active_hold' }, 402);
  } else {
    console.log('[sign-unlock] dev_bypass for DEV-001 — skipping hold check');
  }

  try {
    const signed = cmd === 'unlock'
      ? await signUnlock({ station_id, gate, session_id, duration_min })
      : await signReturnUnlock({ station_id, gate, session_id });
    return json({ ok: true, payload: signed });
  } catch (e) {
    console.error('[sign-unlock] signing failed', e);
    return json({ ok: false, error: 'sign_failed', detail: String(e?.message ?? e) }, 500);
  }
});
