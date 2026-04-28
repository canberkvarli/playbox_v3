import { useCallback } from 'react';
import { supabase } from '@/lib/supabase';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

/**
 * Client wrapper over Supabase Edge Functions that proxy Iyzico.
 * Nothing sensitive lives here; the server signs with merchant keys.
 *
 * Functions expected on the Supabase project:
 *   - iyzico-register-card
 *   - iyzico-preauth
 *   - iyzico-capture-release
 */

export type RegisterCardInput = {
  cardNumber: string;
  cardHolderName: string;
  expireMonth: string;
  expireYear: string;
  cvc: string;
};

export type RegisterCardResult = {
  ok: true;
  last4: string;
  brand: string;
} | {
  ok: false;
  error: string;
};

export type PreauthResult = {
  ok: true;
  holdId: string;
} | {
  ok: false;
  error: string;
};

export type CaptureReleaseResult = {
  ok: true;
} | {
  ok: false;
  error: string;
};

function functionUrl(name: string): string | null {
  if (!SUPABASE_URL) return null;
  return `${SUPABASE_URL.replace(/\/$/, '')}/functions/v1/${name}`;
}

// Dev-only stub responses so the UI can be exercised end-to-end before the
// Supabase Edge Functions are deployed. Production builds skip this branch
// entirely.
function devMock<T>(name: string, body: unknown): T | null {
  if (!__DEV__) return null;
  if (name === 'iyzico-register-card') {
    const cardNumber = String((body as { cardNumber?: string })?.cardNumber ?? '');
    const last4 = cardNumber.slice(-4) || '0000';
    const brand = cardNumber.startsWith('5') ? 'mastercard' : 'visa';
    return { ok: true, last4, brand } as T;
  }
  if (name === 'iyzico-preauth') {
    return { ok: true, holdId: `dev-hold-${Date.now()}` } as T;
  }
  if (name === 'iyzico-capture-release') {
    return { ok: true } as T;
  }
  return null;
}

// 6s upper bound — if the edge function is slow / undeployed we don't want the
// UI to hang forever on submit. AbortController fires the catch path.
const REQUEST_TIMEOUT_MS = 6000;

export function useIyzico() {
  const call = useCallback(
    async <T,>(name: string, body: unknown): Promise<T> => {
      const url = functionUrl(name);
      if (!url) {
        const mock = devMock<T>(name, body);
        if (mock) return mock;
        return { ok: false, error: 'supabase_not_configured' } as T;
      }
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token ?? null;
      if (!token && __DEV__) {
        console.warn(`[iyzico] ${name}: no Supabase session — function will only accept anon-level calls`);
      }

      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);

      // Supabase's edge gateway requires an apikey header (or a verified
      // JWT) BEFORE the request reaches our function code. If we only send
      // Authorization and the session is null, the gateway returns 401
      // with sb_error_code=UNAUTHORIZED_NO_AUTH_HEADER and our function
      // never runs. Always send the anon apikey so the gateway accepts the
      // request, then forward the user JWT in Authorization when we have
      // one (the function uses it to identify the user).
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(SUPABASE_ANON_KEY ? { apikey: SUPABASE_ANON_KEY } : {}),
          Authorization: `Bearer ${token ?? SUPABASE_ANON_KEY ?? ''}`,
        },
        body: JSON.stringify(body ?? {}),
        signal: ctrl.signal,
      })
        .catch((e) => {
          if (__DEV__) console.warn(`[iyzico] ${name} network error`, e);
          return null;
        })
        .finally(() => clearTimeout(timer));

      if (!res) {
        const mock = devMock<T>(name, body);
        if (mock) {
          if (__DEV__) console.warn(`[iyzico] ${name} unreachable, using dev mock`);
          return mock;
        }
        return { ok: false, error: 'network' } as T;
      }
      if (!res.ok) {
        const mock = devMock<T>(name, body);
        if (mock) {
          if (__DEV__) console.warn(`[iyzico] ${name} returned ${res.status}, using dev mock`);
          return mock;
        }
      }
      const json = (await res.json().catch(() => null)) as T | null;
      if (!json) {
        const mock = devMock<T>(name, body);
        if (mock) return mock;
        return { ok: false, error: 'bad_response' } as T;
      }
      return json;
    },
    []
  );

  const registerCard = useCallback(
    (input: RegisterCardInput) => call<RegisterCardResult>('iyzico-register-card', input),
    [call]
  );

  const preauthorize = useCallback(
    (amountTry: number, conversationId: string) =>
      call<PreauthResult>('iyzico-preauth', { amountTry, conversationId }),
    [call]
  );

  const releaseHold = useCallback(
    (holdId: string) =>
      call<CaptureReleaseResult>('iyzico-capture-release', { holdId, action: 'release' }),
    [call]
  );

  const captureHold = useCallback(
    (holdId: string, amountTry: number) =>
      call<CaptureReleaseResult>('iyzico-capture-release', {
        holdId,
        action: 'capture',
        amountTry,
      }),
    [call]
  );

  return { registerCard, preauthorize, releaseHold, captureHold };
}
