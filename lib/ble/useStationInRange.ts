import { useEffect, useState } from 'react';

/**
 * Returns whether the user appears to be in BLE range of the given station.
 *
 * v1 stub: in dev, always reports true so the OYNA flow is testable. In
 * production, returns false until a periodic passive scan confirms the
 * station's device is broadcasting nearby with usable RSSI.
 *
 * Wire-up plan (v2):
 *   - Use stationClient's BleManager to startDeviceScan filtered by SERVICE_UUID.
 *   - When a scanned device's `name` matches the station's BLE name AND
 *     RSSI > -85, set inRange = true. Reset to false if no hit in 6s.
 *   - Stop scanning on unmount.
 */
export function useStationInRange(stationBleName: string | null) {
  const [inRange, setInRange] = useState<boolean>(false);

  useEffect(() => {
    if (!stationBleName) {
      setInRange(false);
      return;
    }
    // Dev convenience: assume in range so we can exercise the unlock UI
    // without standing next to a station. Production code path (v2) replaces
    // this with a real passive RSSI scan.
    if (__DEV__) {
      setInRange(true);
      return;
    }
    setInRange(false);
  }, [stationBleName]);

  return { inRange };
}
