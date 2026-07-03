import { useEffect } from 'react';

import { stationClient } from '@/lib/ble/stationClient';
import { useNearbyStore } from '@/stores/nearbyStore';

/**
 * Keep a CONNECTED station marked "present" even though it isn't advertising.
 *
 * A BLE peripheral stops sending advertisements while a central holds a GATT
 * connection to it. Our presence is driven by the passive advertisement scan,
 * so once we connect (unlock / dev panel / awaiting gate_closed) the station
 * stops producing sightings and its presence decays to "kapalı" within the
 * staleness window — even though we're literally connected to it. That's the
 * "station goes offline after the cycle / BLE range gone" bug.
 *
 * This poller records a synthetic sighting every few seconds for whatever
 * station we currently hold a connection to. It only READS connection state and
 * WRITES the nearby store — it never scans or connects — so it cannot contend
 * with the unlock/return radio work (unlike the reverted app-wide passive scan).
 */
export function useConnectionPresence(): void {
  useEffect(() => {
    const poll = () => {
      const name = stationClient.connectedName?.();
      if (!name) {
        // Link dropped — clear the authoritative "connected = açık" flag. The
        // synthetic sighting we last recorded still rides out the 25s stale
        // window, so a brief flap doesn't flicker the marker to kapalı.
        useNearbyStore.getState().setConnected(null);
        return;
      }
      // BLE advertising name → stationId, e.g. "Playbox-DEV-001" → "DEV-001".
      const stationId = name.startsWith('Playbox-')
        ? name.slice('Playbox-'.length)
        : name;
      const store = useNearbyStore.getState();
      store.setConnected(stationId); // authoritative açık, reactive + instant
      store.record({ stationId, rssi: -50, lastSeenAt: Date.now() });
    };
    poll(); // run once now so açık flips immediately, not after the first tick
    const id = setInterval(poll, 3000);
    return () => clearInterval(id);
  }, []);
}
