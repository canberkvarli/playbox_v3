import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { useAuth } from '@clerk/clerk-expo';
import { useMemo } from 'react';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

/**
 * useSupabase — returns a Supabase client whose auth header is automatically
 * populated with a Clerk-issued JWT (template name: 'supabase'). Configure the
 * template in Clerk Dashboard → JWT Templates → New template → name 'supabase'.
 *
 * Until that template exists, requests will go out without an Authorization
 * header (RLS-protected tables will reject). Read-only public tables still work.
 */
export function useSupabase(): SupabaseClient | null {
  const { getToken } = useAuth();

  return useMemo(() => {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      if (__DEV__) {
        console.warn(
          '[playbox] Supabase env vars not set. Skipping client. Add EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY to .env.local.'
        );
      }
      return null;
    }
    return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: {
        fetch: async (url, opts = {}) => {
          const token = await getToken({ template: 'supabase' }).catch(() => null);
          const headers = new Headers(opts.headers);
          if (token) headers.set('Authorization', `Bearer ${token}`);
          return fetch(url as RequestInfo, { ...opts, headers });
        },
      },
      auth: { persistSession: false },
    });
  }, [getToken]);
}
