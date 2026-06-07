/**
 * Pure radio-state gate. Zero React-Native / native imports so Jest can
 * import it directly and so the decision logic is testable in isolation.
 *
 * The string-union mirrors react-native-ble-plx's `State` enum *values*
 * (the enum is `State.PoweredOn = 'PoweredOn'`, etc). Callers read the live
 * adapter state via `stationClient.currentState()` and pass the raw value
 * here to decide whether an unlock/return is even worth attempting.
 */
export type BtState =
  | 'PoweredOn'
  | 'PoweredOff'
  | 'Unauthorized'
  | 'Unsupported'
  | 'Resetting'
  | 'Unknown';

export type BleAttemptDecision =
  | { ok: true }
  | { ok: false; reason: 'off' | 'unauthorized' | 'unsupported' | 'transient' };

/**
 * Decide whether the BLE radio is in a usable state for an unlock/return.
 *
 * - PoweredOn   → ok (go ahead and scan/write)
 * - PoweredOff  → off          (user must turn Bluetooth on)
 * - Unauthorized→ unauthorized (app lacks BLE permission)
 * - Unsupported → unsupported  (device/platform has no usable BLE)
 * - Resetting   → transient    (radio mid-cycle, not ready yet)
 * - Unknown     → transient    (state not settled yet)
 *
 * `transient` is distinct from `off` so the UI can say "hazırlanıyor /
 * tekrar dene" instead of a misleading "turn on Bluetooth" prompt when the
 * radio is simply still coming up.
 */
export function canAttemptBle(state: BtState): BleAttemptDecision {
  switch (state) {
    case 'PoweredOn':
      return { ok: true };
    case 'PoweredOff':
      return { ok: false, reason: 'off' };
    case 'Unauthorized':
      return { ok: false, reason: 'unauthorized' };
    case 'Unsupported':
      return { ok: false, reason: 'unsupported' };
    case 'Resetting':
    case 'Unknown':
      return { ok: false, reason: 'transient' };
  }
}
