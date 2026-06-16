import * as Updates from 'expo-updates';
import { stationClient } from '@/lib/ble/stationClient';

/**
 * Apply a downloaded OTA update, tearing down BLE first.
 *
 * `Updates.reloadAsync()` re-runs the JS context. react-native-ble-plx then
 * lazily creates a SECOND native CoreBluetooth manager alongside the orphaned
 * pre-reload one — two live managers wedge the radio, so BLE becomes
 * unreachable until the OS kills the process. That is the root cause of "have
 * to reinstall after every OTA / new build": a reinstall was the only path
 * with no reload. Destroying the manager first lets the post-reload manager
 * initialize from a clean slate.
 *
 * ALWAYS route a reloadAsync through here instead of calling it directly.
 */
export async function reloadWithBleTeardown(): Promise<void> {
  try {
    stationClient.destroy();
  } catch {
    // best-effort — never block the reload on teardown
  }
  await Updates.reloadAsync();
}
