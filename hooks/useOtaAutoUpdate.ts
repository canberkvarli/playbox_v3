import { useEffect } from 'react';
import * as Updates from 'expo-updates';
import { reloadWithBleTeardown } from '@/lib/ble/safeReload';

/**
 * Silent auto-update on cold launch.
 *
 * On app start, check for an OTA update; if one is available, download it and
 * reload straight into it — so the user opens the app and is simply on the
 * latest JS, no Settings button, no "relaunch twice" guessing.
 *
 * Safe by construction:
 *   - runtimeVersion is `fingerprint`, so an update is only ever served to a
 *     binary it's actually compatible with — a fetched update will run, it can't
 *     crash-and-roll-back the way an appVersion-pinned mismatch did.
 *   - Best-effort + non-blocking: every step is in try/catch and runs AFTER the
 *     first render (we never block launch on the network). A flaky connection or
 *     a down update server just means "no update this launch."
 *   - No-op in dev / Expo Go / dev clients, where `Updates.isEnabled` is false.
 *
 * Launch-only by design: we do NOT re-check on foreground, so returning to the
 * app mid-session can never reload out from under an active rental/return flow.
 */
export function useOtaAutoUpdate() {
  useEffect(() => {
    if (__DEV__ || !Updates.isEnabled) return;

    let cancelled = false;
    (async () => {
      try {
        const res = await Updates.checkForUpdateAsync();
        if (cancelled || !res.isAvailable) return;
        await Updates.fetchUpdateAsync();
        if (cancelled) return;
        // Reload via the BLE-safe path: a bare reloadAsync() leaves a second
        // CoreBluetooth manager alongside the orphaned pre-reload one and
        // wedges BLE until the process is killed (the "reinstall after every
        // OTA" bug). reloadWithBleTeardown() destroys the native manager first.
        await reloadWithBleTeardown();
      } catch {
        // Best-effort — never block or crash the app on an update check.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);
}
