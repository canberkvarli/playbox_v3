// Pure retry policy for BLE writes. ZERO React Native / native imports so Jest
// can import it directly and exercise the logic without a device. Math.random
// is intentionally NOT called here — the caller injects a random fraction into
// `jitter()` so tests stay deterministic.

export const BASE_DELAY_MS = 200;
export const MAX_DELAY_MS = 2000;
export const DEFAULT_MAX_RETRIES = 3;

/** Jitter spread: +/- this fraction of the delay (25%). */
export const JITTER_FRACTION = 0.25;

/**
 * Delay (ms) for a given 0-based retry attempt: BASE * 2^attempt, capped at
 * MAX_DELAY_MS. attempt 0 -> 200, 1 -> 400, 2 -> 800, 3 -> 1600, 4+ -> 2000.
 */
export function delayForAttempt(attempt: number): number {
  const raw = BASE_DELAY_MS * 2 ** attempt;
  return Math.min(raw, MAX_DELAY_MS);
}

/**
 * Exponential backoff schedule. Default maxRetries=3 -> [200, 400, 800].
 * Each entry is capped at MAX_DELAY_MS, so the sequence is monotonically
 * non-decreasing and never exceeds 2000ms.
 */
export function backoffSchedule(maxRetries: number = DEFAULT_MAX_RETRIES): number[] {
  const out: number[] = [];
  for (let i = 0; i < maxRetries; i++) out.push(delayForAttempt(i));
  return out;
}

/**
 * Apply deterministic jitter to a delay. `fraction` is the injected random
 * value in [0,1] (caller passes Math.random() at the real call site). The
 * result is `delay` scaled into [delay*(1-J), delay*(1+J)] where J =
 * JITTER_FRACTION. fraction=0.5 -> no change; 0 -> -25%; 1 -> +25%.
 * Bounded and pure: same inputs always yield the same output.
 */
export function jitter(delay: number, fraction: number): number {
  const f = Math.max(0, Math.min(1, fraction));
  const offset = (f * 2 - 1) * JITTER_FRACTION; // [-J, +J]
  return Math.round(delay * (1 + offset));
}

export type BleErrorClass =
  | 'retryable'
  | 'bluetooth_off'
  | 'unauthorized'
  | 'signature_rejected'
  | 'terminal';

// Numeric error codes from react-native-ble-plx's BleErrorCode enum that we
// care about. We only hard-code the few that matter for the retry decision;
// everything else falls through to message matching then the conservative
// default.
const ERR_CODE_BLUETOOTH_OFF = new Set([102]); // BluetoothPoweredOff
const ERR_CODE_UNAUTHORIZED = new Set([101]); // BluetoothUnauthorized
const ERR_CODE_RETRYABLE = new Set([
  201, // DeviceDisconnected
  205, // DeviceNotConnected
  300, // ServicesDiscoveryFailed
  301, // IncludedServicesDiscoveryFailed
  402, // CharacteristicWriteFailed
  404, // CharacteristicNotifyChangeFailed
]);

/**
 * Map a ble-plx-style error to a retry class.
 *
 * - Transient GATT / connection / timeout failures -> 'retryable'.
 * - Radio powered off -> 'bluetooth_off' (terminal: nothing to retry against).
 * - Unauthorized / permission -> 'unauthorized' (terminal: needs user action).
 * - Firmware/server signature rejection -> 'signature_rejected' (terminal:
 *   the payload is bad; retrying writes the same rejected bytes).
 * - Anything UNKNOWN -> 'terminal'.
 *
 * UNKNOWN-default rationale: we lean 'terminal' rather than 'retryable' so an
 * unrecognized error does NOT trigger a burst of retries. Hammering the radio /
 * firmware on an error we don't understand is worse than surfacing it once to
 * the existing UI error mapping. Known-transient shapes are matched explicitly
 * above, so the cost of this conservatism is only that a genuinely transient
 * but unrecognized error fails fast — acceptable, and easy to widen later by
 * adding its shape to the retryable set/matchers.
 */
export function classifyBleError(error: unknown): BleErrorClass {
  // Numeric error-code shapes first — most precise signal.
  const code = (error as { errorCode?: unknown })?.errorCode;
  if (typeof code === 'number') {
    if (ERR_CODE_BLUETOOTH_OFF.has(code)) return 'bluetooth_off';
    if (ERR_CODE_UNAUTHORIZED.has(code)) return 'unauthorized';
    if (ERR_CODE_RETRYABLE.has(code)) return 'retryable';
  }

  const msg = String((error as { message?: unknown })?.message ?? error ?? '').toLowerCase();
  if (!msg) return 'terminal';

  // Signature rejection BEFORE unauthorized: a firmware message like
  // "unauthorized signature" is a payload rejection, not a BLE-permission
  // problem, and must stay terminal-but-distinct so the UI can say "expired,
  // try again" rather than "turn on Bluetooth".
  if (msg.includes('signature') || msg.includes('hmac')) return 'signature_rejected';

  if (msg.includes('powered off') || msg.includes('poweredoff')) return 'bluetooth_off';
  if (msg.includes('unauthorized') || msg.includes('permission')) return 'unauthorized';

  // Transient connection-layer failures worth retrying.
  if (
    msg.includes('gatt') ||
    msg.includes('133') ||
    msg.includes('disconnect') ||
    msg.includes('timeout') ||
    msg.includes('timed out') ||
    msg.includes('connection') ||
    msg.includes('not connected') ||
    msg.includes('write failed')
  ) {
    return 'retryable';
  }

  return 'terminal';
}

/** Convenience predicate: only true when the error is transient. */
export function isRetryable(error: unknown): boolean {
  return classifyBleError(error) === 'retryable';
}
