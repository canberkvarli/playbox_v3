import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import 'react-native-url-polyfill/auto';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.warn(
    '[playbox] Supabase env vars missing. Add EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY to .env.local.'
  );
} else {
  console.log(
    '[playbox] Supabase init',
    { url: SUPABASE_URL, keyPrefix: SUPABASE_ANON_KEY.slice(0, 12) }
  );
}

const debugFetch: typeof fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : (input as Request).url;
  const method = init?.method ?? (typeof input !== 'string' ? (input as Request).method : 'GET');
  try {
    const res = await fetch(input, init);
    console.log('[sb-fetch]', method, url, '→', res.status);
    return res;
  } catch (e: any) {
    console.warn('[sb-fetch] FAIL', method, url, '→', e?.message ?? String(e));
    throw e;
  }
};

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
  global: { fetch: debugFetch },
});
