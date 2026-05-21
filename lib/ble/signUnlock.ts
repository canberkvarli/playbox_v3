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
  if (!token) return { ok: false, error: 'not_signed_in' };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
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
}): Promise<UnlockCommand> {
  const res = await callSignUnlock<UnlockCommand>({
    cmd: 'unlock',
    station_id: input.stationId,
    gate: input.gate,
    session_id: input.sessionId,
    duration_min: input.durationMin,
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
}): Promise<ReturnUnlockCommand> {
  const res = await callSignUnlock<ReturnUnlockCommand>({
    cmd: 'return_unlock',
    station_id: input.stationId,
    gate: input.gate,
    session_id: input.sessionId,
  });
  if (!res.ok) {
    throw new Error(`sign-unlock failed: ${res.error}${res.detail ? ` (${res.detail})` : ''}`);
  }
  return res.payload;
}
