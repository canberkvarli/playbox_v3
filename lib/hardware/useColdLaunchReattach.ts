import { useEffect } from 'react';
import { useSessionStore } from '@/stores/sessionStore';
import { getDriver } from '@/lib/hardware';
import { reattachActiveStationWatch, stopActiveStationReattach } from '@/lib/hardware/ble';

/**
 * Boot-time cold-launch recovery hook. Mount once at the app root.
 *
 * When the app is killed mid-session and relaunched, the active session is
 * restored from AsyncStorage (zustand persist) but the BLE EVENTS subscription
 * is NOT re-opened — so a `gate_closed` arriving after the user pushes the door
 * shut would be missed and the return could never auto-confirm.
 *
 * This hook waits for the persisted store to finish (async) hydrating, then
 * asks `reattachActiveStationWatch` to re-establish the passive watch + EVENTS
 * subscription for the recovered session. That helper is RESUBSCRIBE-ONLY
 * (no writes / no auto-return), idempotent, and best-effort (never throws), so
 * mounting this is safe even when there is no active session.
 *
 * The live meter/timer needs no work here: the play screen derives it purely
 * from the persisted `startedAt` / `durationMinutes`, so it already resumes on
 * its own once the store rehydrates.
 */
export function useColdLaunchReattach(): void {
  useEffect(() => {
    const persist = useSessionStore.persist;

    const run = () => {
      // best-effort by contract; reattachActiveStationWatch swallows its own
      // errors, but guard here too so nothing in this effect can crash launch.
      try {
        reattachActiveStationWatch(getDriver());
      } catch {
        /* never crash launch */
      }
    };

    // zustand's persist API: if hydration already finished (sync storages or a
    // fast async resolve), run immediately. Otherwise wait for the one-shot
    // onFinishHydration callback. Some store mocks may not expose `persist`;
    // fall back to running directly.
    if (!persist || typeof persist.hasHydrated !== 'function') {
      run();
      return () => stopActiveStationReattach();
    }

    let unsub: (() => void) | undefined;
    if (persist.hasHydrated()) {
      run();
    } else {
      unsub = persist.onFinishHydration(run);
    }

    return () => {
      unsub?.();
      stopActiveStationReattach();
    };
  }, []);
}
