import { useCallback } from 'react';
import { supabase } from '@/lib/supabase';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;

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

export function useIyzico() {
  const call = useCallback(
    async <T,>(name: string, body: unknown): Promise<T> => {
      const url = functionUrl(name);
      if (!url) {
        return { ok: false, error: 'supabase_not_configured' } as T;
      }
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token ?? null;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body ?? {}),
      }).catch((e) => {
        if (__DEV__) console.warn(`[iyzico] ${name} network error`, e);
        return null;
      });
      if (!res) return { ok: false, error: 'network' } as T;
      const json = (await res.json().catch(() => null)) as T | null;
      if (!json) return { ok: false, error: 'bad_response' } as T;
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
    (holdId: string) =>
      call<CaptureReleaseResult>('iyzico-capture-release', { holdId, action: 'capture' }),
    [call]
  );

  return { registerCard, preauthorize, releaseHold, captureHold };
}
