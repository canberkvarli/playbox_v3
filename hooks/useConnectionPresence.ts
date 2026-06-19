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
    const id = setInterval(() => {
      const name = stationClient.connectedName?.();
      if (!name) return;
      // BLE advertising name → stationId, e.g. "Playbox-DEV-001" → "DEV-001".
      const stationId = name.startsWith('Playbox-')
        ? name.slice('Playbox-'.length)
        : name;
      useNearbyStore.getState().record({
        stationId,
        rssi: -50,
        lastSeenAt: Date.now(),
      });
    }, 3000);
    return () => clearInterval(id);
  }, []);
}
