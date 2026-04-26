import { useCallback, useEffect, useRef, useState } from 'react';

import { supabase } from '@/lib/supabase';
import type { Sport } from '@/data/stations.seed';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;

/** Default 30-min lock window. Server is authoritative; this is just for
 *  copy that needs a number before any RPC has resolved. */
export const RESERVATION_LOCK_MIN = 30;

// ============================================================
// Types — mirror the server schema in supabase/migrations/...
// ============================================================

export type ReservationStatus =
  | 'active'
  | 'consumed'
  | 'cancelled'
  | 'expired_captured'
  | 'expired_released';

export type Reservation = {
  id: string;
  user_id: string;
  station_id: string;
  sport: Sport;
  gate_id: string;
  hold_id: string | null;
  hold_amount_try: number;
  terms_version: number;
  status: ReservationStatus;
  created_at: string; // ISO
  expires_at: string; // ISO
  terminal_at: string | null;
  client_meta: Record<string, unknown> | null;
};

export type LockReason = 'tier_24h' | 'tier_7d' | 'manual_review' | 'payment_failed';

export type ReservationLock = {
  reason: LockReason;
  // ISO timestamp, or the literal string "infinity" for manual_review / payment_failed.
  locked_until: string;
  triggered_by_id: string | null;
  created_at: string;
};

export type ReservationState = {
  active: Reservation | null;
  recent: Reservation[];
  lock: ReservationLock | null;
  terms_version_required: number;
  terms_version_accepted: number | null;
  hold_amount_try: number;
};

// ============================================================
// Edge function input/output types (snake_case to match server)
// ============================================================

export type CreateInput = {
  station_id: string;
  sport: Sport;
  gate_id: string;
  agreed?: boolean;
  app_version?: string;
};

export type CreateError =
  | 'unauthorized'
  | 'bad_request'
  | 'no_card'
  | 'card_declined'
  | 'preauth_failed'
  | 'locked'
  | 'has_active_reservation'
  | 'gate_taken'
  | 'gate_taken_race'
  | 'terms_required'
  | 'velocity_hour'
  | 'velocity_day'
  | 'iyzico_not_configured'
  | 'service_role_missing'
  | 'insert_failed'
  | 'network'
  | 'bad_response';

export type CreateResult =
  | { ok: true; reservation: Reservation }
  | {
      ok: false;
      error: CreateError;
      reason?: LockReason;
      locked_until?: string;
      terms_version?: number;
      reservation_id?: string;
    };

export type CancelResult =
  | { ok: true; status: 'cancelled' | 'expired_captured'; lock?: LockReason | null }
  | {
      ok: false;
      error:
        | 'unauthorized'
        | 'bad_request'
        | 'not_found'
        | 'not_active'
        | 'capture_failed'
        | 'iyzico_not_configured'
        | 'service_role_missing'
        | 'no_hold'
        | 'network'
        | 'bad_response';
      status?: ReservationStatus;
    };

export type ConsumeInput = {
  reservation_id: string;
  station_id: string;
  gate_id: string;
};

export type ConsumeResult =
  | { ok: true; reservation_id: string }
  | {
      ok: false;
      error:
        | 'unauthorized'
        | 'bad_request'
        | 'not_found'
        | 'not_active'
        | 'gate_mismatch'
        | 'expired'
        | 'iyzico_not_configured'
        | 'service_role_missing'
        | 'no_hold'
        | 'network'
        | 'bad_response';
      expected?: { station_id: string; gate_id: string };
      status?: ReservationStatus;
    };

export type RetryCaptureResult =
  | { ok: true; lock_cleared: true }
  | {
      ok: false;
      error:
        | 'unauthorized'
        | 'bad_request'
        | 'not_found'
        | 'wrong_status'
        | 'no_payment_failed_lock'
        | 'retry_failed'
        | 'iyzico_not_configured'
        | 'service_role_missing'
        | 'no_hold'
        | 'network'
        | 'bad_response';
      iyzico_error?: string;
      status?: ReservationStatus;
    };

export type SweepResult =
  | {
      ok: true;
      swept: number;
      captured?: number;
      capture_failed?: number;
      system_fault?: number;
      mode: 'cron' | 'user';
    }
  | { ok: false; error: string };

// ============================================================
// HTTP plumbing (mirrors lib/iyzico.ts conventions)
// ============================================================

const REQUEST_TIMEOUT_MS = 6000;

function functionUrl(name: string): string | null {
  if (!SUPABASE_URL) return null;
  return `${SUPABASE_URL.replace(/\/$/, '')}/functions/v1/${name}`;
}

async function callEdge<T>(name: string, body: unknown): Promise<T> {
  const url = functionUrl(name);
  if (!url) return { ok: false, error: 'supabase_not_configured' } as T;

  const {
    data: { session },
  } = await supabase.auth.getSession();
  const token = session?.access_token ?? null;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body ?? {}),
    signal: ctrl.signal,
  })
    .catch((e) => {
      if (__DEV__) console.warn(`[reservations] ${name} network error`, e);
      return null;
    })
    .finally(() => clearTimeout(timer));

  if (!res) return { ok: false, error: 'network' } as T;
  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    if (__DEV__) console.warn(`[reservations] ${name} non-JSON response`, text.slice(0, 200));
    return { ok: false, error: 'bad_response' } as T;
  }
  return parsed as T;
}

// ============================================================
// Imperative API — call from event handlers (reserve / cancel / etc.)
// ============================================================

export function useReservationsApi() {
  const fetchState = useCallback(async (): Promise<ReservationState | null> => {
    const { data, error } = await supabase.rpc('get_my_reservation_state');
    if (error) {
      if (__DEV__) console.warn('[reservations] fetchState rpc error', error);
      return null;
    }
    return (data as ReservationState) ?? null;
  }, []);

  const lazySweep = useCallback(() => callEdge<SweepResult>('reservation-sweep', {}), []);

  const create = useCallback(
    (input: CreateInput) => callEdge<CreateResult>('reservation-create', input),
    [],
  );

  const cancel = useCallback(
    (reservationId: string) =>
      callEdge<CancelResult>('reservation-cancel', { reservation_id: reservationId }),
    [],
  );

  const consume = useCallback(
    (input: ConsumeInput) => callEdge<ConsumeResult>('reservation-consume', input),
    [],
  );

  const retryCapture = useCallback(
    (reservationId: string) =>
      callEdge<RetryCaptureResult>('reservation-retry-capture', {
        reservation_id: reservationId,
      }),
    [],
  );

  return { fetchState, lazySweep, create, cancel, consume, retryCapture };
}

// ============================================================
// Reactive hook — hydrates ReservationState, sweeps stale rows,
// re-fetches on demand. Use this from screens that display state.
// ============================================================

type UseReservationStateOptions = {
  /** Re-fetch every N ms while mounted. Default 15s. Set to 0 to disable polling. */
  pollMs?: number;
  /** Run a lazy server-side sweep before each fetch. Default true. */
  sweepBeforeFetch?: boolean;
};

export type UseReservationStateReturn = {
  state: ReservationState | null;
  loading: boolean;
  refresh: () => Promise<void>;
};

export function useReservationState(
  options: UseReservationStateOptions = {},
): UseReservationStateReturn {
  const { pollMs = 15_000, sweepBeforeFetch = true } = options;
  const [state, setState] = useState<ReservationState | null>(null);
  const [loading, setLoading] = useState(true);
  const { fetchState, lazySweep } = useReservationsApi();
  const mountedRef = useRef(true);

  const refresh = useCallback(async () => {
    if (sweepBeforeFetch) {
      // Best-effort; ignore errors. Defends against pg_cron lag.
      await lazySweep().catch(() => null);
    }
    const next = await fetchState();
    if (mountedRef.current) {
      setState(next);
      setLoading(false);
    }
  }, [fetchState, lazySweep, sweepBeforeFetch]);

  useEffect(() => {
    mountedRef.current = true;
    refresh();
    if (pollMs <= 0) return () => { mountedRef.current = false; };
    const id = setInterval(refresh, pollMs);
    return () => {
      mountedRef.current = false;
      clearInterval(id);
    };
  }, [refresh, pollMs]);

  return { state, loading, refresh };
}

// ============================================================
// Helpers
// ============================================================

export function isLockActive(lock: ReservationLock | null | undefined): boolean {
  if (!lock) return false;
  if (lock.locked_until === 'infinity') return true;
  return new Date(lock.locked_until).getTime() > Date.now();
}

export function lockSecondsRemaining(lock: ReservationLock | null | undefined): number {
  if (!lock) return 0;
  if (lock.locked_until === 'infinity') return Number.POSITIVE_INFINITY;
  return Math.max(0, Math.ceil((new Date(lock.locked_until).getTime() - Date.now()) / 1000));
}

export function reservationSecondsRemaining(r: Reservation | null | undefined): number {
  if (!r || r.status !== 'active') return 0;
  return Math.max(0, Math.ceil((new Date(r.expires_at).getTime() - Date.now()) / 1000));
}

export function reservationGraceSecondsLeft(
  r: Reservation | null | undefined,
  graceSeconds = 120,
): number {
  if (!r || r.status !== 'active') return 0;
  const elapsed = (Date.now() - new Date(r.created_at).getTime()) / 1000;
  return Math.max(0, Math.ceil(graceSeconds - elapsed));
}
