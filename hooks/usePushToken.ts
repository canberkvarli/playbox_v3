import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

import { supabase } from '@/lib/supabase';

// expo-device is optional — if it's not installed, fall back to assuming
// real device. The token API still works on physical devices either way;
// the only effect of this fallback is that simulators may try to register
// and silently fail.
let Device: { isDevice: boolean; modelName: string | null; osVersion: string | null } = {
  isDevice: true,
  modelName: null,
  osVersion: null,
};
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require('expo-device');
  Device = {
    isDevice: !!mod.isDevice,
    modelName: mod.modelName ?? null,
    osVersion: mod.osVersion ?? null,
  };
} catch {}

/**
 * Registers the Expo push token with the backend on mount.
 *
 * - Asks for notification permissions (no-op if already granted/denied)
 * - Fetches the Expo push token tied to this device + EAS project
 * - Upserts it into user_push_tokens (RLS allows owner-writes)
 * - Returns { token, status } so the caller can show diagnostic info
 *
 * Safe to call from the root layout — early-exits when Notifications
 * isn't available (web, simulator without device).
 */
export function usePushToken() {
  const [token, setToken] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'requesting' | 'granted' | 'denied' | 'error'>(
    'idle',
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!Device.isDevice) return; // simulators don't get tokens
      setStatus('requesting');

      const { status: existing } = await Notifications.getPermissionsAsync();
      let perm = existing;
      if (existing !== 'granted') {
        const req = await Notifications.requestPermissionsAsync();
        perm = req.status;
      }
      if (perm !== 'granted') {
        if (!cancelled) setStatus('denied');
        return;
      }

      if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync('default', {
          name: 'default',
          importance: Notifications.AndroidImportance.DEFAULT,
        });
      }

      try {
        const expoToken = await Notifications.getExpoPushTokenAsync();
        if (cancelled) return;
        setToken(expoToken.data);
        setStatus('granted');

        // Persist to backend. Best-effort — failures here are non-fatal.
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user?.id) {
          await supabase.from('user_push_tokens').upsert(
            {
              user_id: session.user.id,
              expo_token: expoToken.data,
              device_info: {
                platform: Platform.OS,
                model: Device.modelName,
                os_version: Device.osVersion,
              },
            },
            { onConflict: 'user_id' },
          );
        }
      } catch (e) {
        if (__DEV__) console.warn('[usePushToken] failed', e);
        if (!cancelled) setStatus('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { token, status };
}
