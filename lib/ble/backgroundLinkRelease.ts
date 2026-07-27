import { AppState, type AppStateStatus } from 'react-native';

import { stationClient } from '@/lib/ble/stationClient';

/**
 * Release the GATT link when the app goes to the background.
 *
 * WHY THIS EXISTS. Holding a link is not free the way holding a socket is: a
 * BLE peripheral STOPS ADVERTISING as soon as a central connects to it. So a
 * link we keep while the app is backgrounded makes that station invisible —
 * to the map, to a fresh scan, and to every OTHER user standing at the same
 * locker. A 3-gate box serves three people at once; one suspended phone must
 * not take all three hostage.
 *
 * It isn't even a working link. A suspended iOS app can't service the
 * connection, so the board eventually hits its supervision timeout — and
 * CoreBluetooth then hides the (still "connected") peripheral from our own
 * scans too. That is the orphaned-link failure we already had to write
 * recovery code for. Releasing on the way out is strictly safer than
 * discovering it on the way back in.
 *
 * The link is therefore held ONLY while the app is in the foreground, which is
 * exactly when it earns its keep: during an active session the return tap
 * lands instantly. Everything else re-connects on demand — cheaply, because
 * the advert cache stays warm.
 */

/**
 * Grace period before we actually drop the link. iOS emits 'background' during
 * some transient transitions, and we'd rather not tear down a link the user is
 * about to come straight back to.
 */
const RELEASE_GRACE_MS = 2000;

let releaseTimer: ReturnType<typeof setTimeout> | null = null;
let installed = false;

function cancelPendingRelease(): void {
  if (!releaseTimer) return;
  clearTimeout(releaseTimer);
  releaseTimer = null;
}

function onAppStateChange(state: AppStateStatus): void {
  if (state === 'active') {
    // Came back before the grace elapsed (or the timer never got to run
    // because iOS suspended us) — keep the link.
    cancelPendingRelease();
    return;
  }
  // 'inactive' is NOT backgrounding: it fires for the app switcher, Control
  // Centre, an incoming call banner, and — the one that matters here — the
  // in-app camera the closing-photo step presents. Dropping the link there
  // would kill the connection mid-return for no reason.
  if (state !== 'background') return;
  if (releaseTimer) return;
  releaseTimer = setTimeout(() => {
    releaseTimer = null;
    // Re-check rather than trust the timer: if iOS suspended us the moment we
    // backgrounded, this callback doesn't run until we're foregrounded again,
    // and disconnecting right as the user returns is the opposite of what we
    // want.
    if (AppState.currentState === 'active') return;
    if (!stationClient.isConnected()) return;
    stationClient.disconnect().catch(() => {
      // best-effort — a failed teardown must never surface or throw
    });
  }, RELEASE_GRACE_MS);
}

/**
 * Install the listener. Idempotent, so a Fast-Refresh re-run of the boot effect
 * can't stack duplicate listeners.
 */
export function installBackgroundLinkRelease(): void {
  if (installed) return;
  installed = true;
  AppState.addEventListener('change', onAppStateChange);
}
