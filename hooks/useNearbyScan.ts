import { useEffect } from 'react';
import { AppState } from 'react-native';

import { getDriver } from '@/lib/hardware';
import { useNearbyStore } from '@/stores/nearbyStore';

/**
 * App-wide passive BLE scan. Runs continuously while the app is foregrounded
 * (on EVERY screen, not just the map), recording each Playbox-* advertisement
 * into the nearby store. The map markers, the drawer list and the
 * station-detail header all read from this one live source, so they stay
 * consistent — "if it's off it's off, if it's on it's on" everywhere at once.
 *
 * WHY app-level instead of per-screen: the map used to stop its scan on blur
 * and the station screen started its own. Navigating map → station → back left
 * a scan gap during which fresh sightings expired, so a live station briefly
 * flipped to "kapalı" (the "marker disappears and comes back" glitch). One
 * never-interrupted scan removes the gap.
 *
 * Pauses on background (battery) and resumes on foreground. The passive scan is
 * coordinated with `scanAndConnect` inside stationClient — a targeted unlock
 * scan transparently pauses this one and it auto-restarts after — so leaving it
 * running does not interfere with unlocking.
 */
export function useNearbyScan(): void {
  useEffect(() => {
    let sub: { stop: () => void } | null = null;

    const start = () => {
      if (sub) return;
      sub = getDriver().watchNearbyStations((sighting) => {
        useNearbyStore.getState().record(sighting);
      });
    };
    const stop = () => {
      sub?.stop();
      sub = null;
    };

    if (AppState.currentState === 'active') start();

    const handler = AppState.addEventListener('change', (state) => {
      if (state === 'active') start();
      else stop();
    });

    return () => {
      handler.remove();
      stop();
    };
  }, []);
}
