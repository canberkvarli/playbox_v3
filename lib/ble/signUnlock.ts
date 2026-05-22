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
}): Promise<UnlockCommand> {
  const res = await callSignUnlock<UnlockCommand>({
    cmd: 'unlock',
    station_id: input.stationId,
    gate: input.gate,
    session_id: input.sessionId,
    duration_min: input.durationMin,
    dev_bypass: input.devBypass ?? false,
  });
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
  const res = await callSignUnlock<ReturnUnlockCommand>({
    cmd: 'return_unlock',
    station_id: input.stationId,
    gate: input.gate,
    session_id: input.sessionId,
    dev_bypass: input.devBypass ?? false,
  });
  if (!res.ok) {
    throw new Error(`sign-unlock failed: ${res.error}${res.detail ? ` (${res.detail})` : ''}`);
  }
  return res.payload;
}
