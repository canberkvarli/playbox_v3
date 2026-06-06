// Calls the `sign-unlock` Supabase Edge Function and returns a payload that
// `stationClient.unlock` / `stationClient.returnUnlock` can write directly to
// BLE. The phone is a dumb pipe — all crypto happens on the server.

import { supabase } from '@/lib/supabase';
import type { UnlockCommand, ReturnUnlockCommand } from './protocol';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const REQUEST_TIMEOUT_MS = 6_000;

function functionUrl(name: string): string | null {
  if (!SUPABASE_URL) return null;
  return `${SUPABASE_URL.replace(/\/$/, '')}/functions/v1/${name}`;
}

type EdgeResponse<T> =
  | { ok: true; payload: T }
  | { ok: false; error: string; detail?: string };

/**
 * Builds the JSON body for the `sign-unlock` Edge Function. Pure (no I/O, no
 * imports) so it is unit-testable directly under Jest.
 *
 * Keys are snake_case to match the server contract:
 *  - `cmd`, `station_id`, `gate`, `session_id` are always present.
 *  - `gate` is the NUMERIC gate index used for the BLE HMAC — never the slug.
 *  - `duration_min` is included only for the `unlock` command.
 *  - `dev_bypass` is included only when explicitly true.
 *  - `gate_id` (the reservation-linkage slug, e.g. `DEV-001-football-1`) is
 *    included ONLY when a non-empty string is provided. We never emit
 *    `null`/`"undefined"`; the server treats a missing key as "no linkage".
 */
export function buildSignUnlockBody(args: {
  cmd: 'unlock' | 'return_unlock';
  stationId: string;
  gate: number;
  sessionId: string;
  durationMin?: number;
  devBypass?: boolean;
  gateId?: string;
}): Record<string, unknown> {
  const body: Record<string, unknown> = {
    cmd: args.cmd,
    station_id: args.stationId,
    gate: args.gate,
    session_id: args.sessionId,
  };
  if (args.cmd === 'unlock') {
    body.duration_min = args.durationMin;
  }
  if (args.devBypass === true) {
    body.dev_bypass = true;
  }
  if (typeof args.gateId === 'string' && args.gateId.length > 0) {
    body.gate_id = args.gateId;
  }
  return body;
}

async function callSignUnlock<T>(body: unknown): Promise<EdgeResponse<T>> {
  const url = functionUrl('sign-unlock');
  if (!url) return { ok: false, error: 'supabase_not_configured' };

  const {
    data: { session },
  } = await supabase.auth.getSession();
  const token = session?.access_token ?? null;
  // Phase 0 dev shortcut: when called with dev_bypass=true (only honored
  // server-side for DEV-001), skip the "must be signed in" gate so we can
  // smoke-test the servo without an account.
  const devBypass = (body as { dev_bypass?: boolean })?.dev_bypass === true;
  if (!token && !devBypass) return { ok: false, error: 'not_signed_in' };

  const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';
  const authHeader = token ? `Bearer ${token}` : `Bearer ${SUPABASE_ANON_KEY}`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authHeader,
        apikey: SUPABASE_ANON_KEY,
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await res.text();
    let parsed: EdgeResponse<T>;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { ok: false, error: 'bad_response', detail: text.slice(0, 200) };
    }
    return parsed;
  } catch (e) {
    return { ok: false, error: 'network', detail: String((e as Error)?.message ?? e) };
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchSignedUnlock(input: {
  stationId: string;
  gate: number;
  sessionId: string;
  durationMin: number;
  /** Phase 0 only: bypass payment-hold check on the server. Honored only
   *  for stationId === 'DEV-001'. */
  devBypass?: boolean;
  /** Reservation-linkage slug, e.g. `DEV-001-football-1`. Sent as `gate_id`
   *  so the server can link this unlock to the reservation. Omitted from the
   *  request entirely when absent — linkage just no-ops server-side. */
  gateId?: string;
}): Promise<UnlockCommand> {
  const res = await callSignUnlock<UnlockCommand>(
    buildSignUnlockBody({
      cmd: 'unlock',
      stationId: input.stationId,
      gate: input.gate,
      sessionId: input.sessionId,
      durationMin: input.durationMin,
      devBypass: input.devBypass,
      gateId: input.gateId,
    }),
  );
  if (!res.ok) {
    throw new Error(`sign-unlock failed: ${res.error}${res.detail ? ` (${res.detail})` : ''}`);
  }
  return res.payload;
}

export async function fetchSignedReturnUnlock(input: {
  stationId: string;
  gate: number;
  sessionId: string;
  /** Phase 0 only: same as fetchSignedUnlock.devBypass. */
  devBypass?: boolean;
}): Promise<ReturnUnlockCommand> {
  // No gate_id here: reservation linkage happens at unlock time, so the
  // return path intentionally omits it.
  const res = await callSignUnlock<ReturnUnlockCommand>(
    buildSignUnlockBody({
      cmd: 'return_unlock',
      stationId: input.stationId,
      gate: input.gate,
      sessionId: input.sessionId,
      devBypass: input.devBypass,
    }),
  );
  if (!res.ok) {
    throw new Error(`sign-unlock failed: ${res.error}${res.detail ? ` (${res.detail})` : ''}`);
  }
  return res.payload;
}
