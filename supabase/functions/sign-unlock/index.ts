// @ts-nocheck — Deno runtime
//
// sign-unlock
// Returns an HMAC-signed BLE unlock payload that the phone relays directly
// to the station over BLE. The phone never sees the station secret.
//
// DEPLOY: must be deployed with --no-verify-jwt so the function can handle
// its own auth (the gateway 401 would otherwise reject the DEV-001
// dev_bypass call before our code runs). The function itself enforces
// auth on every non-dev-bypass call.
//   npx supabase functions deploy sign-unlock --no-verify-jwt
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
import { selectReservationToLink } from './link-session.ts';

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
    ts?: number;
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

  let signed: string;
  try {
    signed = cmd === 'unlock'
      ? await signUnlock({ station_id, gate, session_id, duration_min })
      : await signReturnUnlock({ station_id, gate, session_id });
  } catch (e) {
    console.error('[sign-unlock] signing failed', e);
    return json({ ok: false, error: 'sign_failed', detail: String(e?.message ?? e) }, 500);
  }

  // Best-effort: persist the BLE session<->reservation linkage so the server
  // can later tie an incoming `gate_closed`/`gate_opened` event (which carries
  // only session_id) back to the reservation it fulfils. This is the keystone
  // of server-side reconciliation, but it is SECONDARY to the unlock itself:
  // if anything below fails we log and continue — the unlock payload has
  // already been signed and the user must still be able to open the gate.
  //
  // We only do this for a real `unlock` from an authenticated user (the
  // DEV-001 dev_bypass path has no reservation to link).
  //
  // The actual decision (which reservation, idempotency, conflict handling)
  // lives in the pure, Jest-tested ./link-session.ts; here we only do I/O.
  if (cmd === 'unlock' && userId) {
    try {
      const { data: candidates, error: candErr } = await admin
        .from('reservations')
        .select('id, status, gate_id, ble_session_id, created_at')
        .eq('user_id', userId)
        .eq('station_id', station_id)
        .in('status', ['active', 'consumed'])
        .order('created_at', { ascending: false });

      if (candErr) {
        console.error('[sign-unlock] reservation lookup failed (non-blocking)', candErr);
      } else {
        // The signed unlock targets a specific physical gate. reservations.gate_id
        // is the gate identifier (TEXT). The BLE payload carries `gate` as a
        // number; we compare against gate_id as a string.
        const gateId = String(gate);
        const decision = selectReservationToLink(candidates ?? [], gateId, session_id);

        if ('reservationId' in decision) {
          // Guard with user_id so we can never touch another user's row.
          const { error: updErr } = await admin
            .from('reservations')
            .update({ ble_session_id: session_id })
            .eq('id', decision.reservationId)
            .eq('user_id', userId);

          if (updErr) {
            console.error('[sign-unlock] ble_session_id update failed (non-blocking)', updErr);
          } else {
            // opened_at stays null until the gate_opened event arrives.
            const { error: evtErr } = await admin.from('reservation_events').insert({
              reservation_id: decision.reservationId,
              kind: 'unlock_signed',
              payload: { session_id, gate_id: gateId, ts: body.ts ?? null },
            });
            if (evtErr) {
              console.error('[sign-unlock] reservation_events insert failed (non-blocking)', evtErr);
            }
          }
        } else {
          console.log('[sign-unlock] no linkage applied', decision);
        }
      }
    } catch (linkErr) {
      // Reconciliation is secondary — never fail the unlock for it.
      console.error('[sign-unlock] linkage step threw (non-blocking)', linkErr);
    }
  }

  return json({ ok: true, payload: signed });
});
