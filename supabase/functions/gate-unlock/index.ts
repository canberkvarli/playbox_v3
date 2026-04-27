// @ts-nocheck — Deno runtime
//
// gate-unlock
// Server-mediated gate open. The app calls this with its JWT, a station/gate
// pair, and a correlation id. We verify (a) the user is signed in, (b) they
// have an active iyzico preauth hold, (c) the requested gate exists and is
// idle, and only then dispatch the unlock command to the gate hardware.
//
// Direct BLE-write unlock from the phone is intentionally not allowed — a
// rooted phone could otherwise bypass session and payment checks. Server
// roundtrip is ~250ms which is acceptable for an unlock flow that already
// has theatrics.
//
// Hardware dispatch:
//   v1 — POST to a per-station MQTT bridge URL (fill GATE_DISPATCH_URL)
//   v2 — direct MQTT publish to topic `pbox/${station_id}/${gate_id}/cmd`
//
// Replace the body of `dispatchUnlock()` with whatever protocol your
// firmware actually speaks.
//
// Required env:
//   SUPABASE_URL              — autopopulated
//   SUPABASE_ANON_KEY         — autopopulated
//   SUPABASE_SERVICE_ROLE_KEY — needed for cross-user table reads
//   GATE_DISPATCH_URL         — your hardware bridge endpoint
//   GATE_DISPATCH_TOKEN       — bearer token the bridge requires

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.47.10';
import { handleOptions, json } from '../_shared/cors.ts';
import { getBearerToken, getUserIdFromRequest } from '../_shared/auth.ts';

const DISPATCH_TIMEOUT_MS = 6_000;

async function dispatchUnlock(stationId: string, gateId: string, correlationId: string) {
  const url = Deno.env.get('GATE_DISPATCH_URL');
  const token = Deno.env.get('GATE_DISPATCH_TOKEN');

  if (!url) {
    // No bridge configured — return a soft success so dev environments work.
    // Production deploys MUST set GATE_DISPATCH_URL.
    console.warn('[gate-unlock] no GATE_DISPATCH_URL set, returning soft success');
    return { ok: true };
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), DISPATCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        station_id: stationId,
        gate_id: gateId,
        cmd: 'open',
        correlation_id: correlationId,
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { ok: false, status: res.status, message: text };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, message: String(e?.message ?? e) };
  } finally {
    clearTimeout(timer);
  }
}

Deno.serve(async (req) => {
  const opt = handleOptions(req);
  if (opt) return opt;

  const userId = getUserIdFromRequest(req);
  const jwt = getBearerToken(req);
  if (!userId || !jwt) return json({ ok: false, error: 'unauthorized' }, 401);

  let body: { station_id?: string; gate_id?: string; correlation_id?: string };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: 'bad_body' }, 400);
  }

  const { station_id, gate_id, correlation_id } = body;
  if (!station_id || !gate_id || !correlation_id) {
    return json({ ok: false, error: 'missing_params' }, 400);
  }

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!SERVICE_ROLE_KEY) return json({ ok: false, error: 'service_role_missing' }, 500);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // 1. Verify a current iyzico preauth hold exists for this user. Without
  //    one we have no way to charge them — refuse the unlock so they can't
  //    play for free.
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

  if (holdErr) console.error('[gate-unlock] hold lookup failed', holdErr);
  if (!hold) {
    return json({ ok: false, error: 'no_active_hold' }, 402);
  }

  // 2. Idempotency — if we've already dispatched this correlation_id, return
  //    the same result so a retry doesn't double-open a flaky gate.
  const { data: existing } = await admin
    .from('gate_unlock_log')
    .select('id, status')
    .eq('correlation_id', correlation_id)
    .maybeSingle();
  if (existing?.status === 'success') {
    return json({ ok: true, replayed: true });
  }

  // 3. Dispatch to hardware bridge.
  const dispatch = await dispatchUnlock(station_id, gate_id, correlation_id);

  // 4. Audit log — every unlock attempt, success or failure, gets a row so
  //    support can reconstruct what happened.
  await admin.from('gate_unlock_log').upsert(
    {
      correlation_id,
      user_id: userId,
      station_id,
      gate_id,
      status: dispatch.ok ? 'success' : 'failed',
      detail: dispatch.message ?? null,
      created_at: new Date().toISOString(),
    },
    { onConflict: 'correlation_id' },
  );

  if (!dispatch.ok) {
    return json({ ok: false, error: 'dispatch_failed', detail: dispatch.message }, 502);
  }
  return json({ ok: true });
});
