/**
 * Hardware integration interfaces. Everything the app needs to talk to
 * physical stations goes through these contracts so we can swap mock ↔
 * real-BLE without touching screens.
 *
 * Three operations matter for v1:
 *   - Detect that the user is physically near a station (BLE proximity)
 *   - Open a specific gate (BLE write OR server-mediated MQTT — both ok
 *     to surface as one method here)
 *   - Confirm a gate has actually opened (so we don't start the timer
 *     against a stuck door)
 */

export type ProximityState =
  | { kind: 'idle' }
  | { kind: 'scanning' }
  | { kind: 'in_range'; rssi: number; lastSeenAt: number }
  | { kind: 'out_of_range' }
  | { kind: 'permission_denied' }
  | { kind: 'bluetooth_off' }
  | { kind: 'unsupported' };

export type UnlockResult =
  | { ok: true; openedAt: number }
  | { ok: false; error: UnlockError; message?: string };

export type UnlockError =
  | 'not_in_range'           // BLE proximity check failed
  | 'permission_denied'      // user denied bluetooth/location
  | 'bluetooth_off'          // OS BLE adapter is off
  | 'connection_failed'      // could not connect to gate device
  | 'auth_rejected'          // gate refused the session token
  | 'gate_busy'              // gate already opening / opened by someone else
  | 'timeout'                // command sent but no ack within window
  | 'network'                // server-mediated unlock couldn't reach Iyzico/MQTT
  | 'unsupported'            // running on a platform without BLE
  | 'unknown';

export type HardwareDriver = {
  /**
   * Begin watching for a specific station's BLE advertisement. Returns a
   * subscription handle — call `stop()` on unmount to avoid keeping the
   * radio hot.
   */
  watchStation(stationId: string, onChange: (s: ProximityState) => void): {
    stop: () => void;
  };

  /**
   * Open the specified gate. Implementation can be:
   *   - direct BLE write to the station's unlock characteristic
   *   - HTTP POST to a server function that fans out via MQTT
   *   - both (try BLE first, fall back to server)
   *
   * Implementations are expected to handle their own permission prompts
   * and time out at most 8s.
   */
  unlockGate(args: {
    stationId: string;
    gateId: string;
    /** JWT for the active Supabase session — gates verify this server-side. */
    sessionToken: string;
    /** Idempotency key, generated client-side, stable across retries. */
    correlationId: string;
  }): Promise<UnlockResult>;

  /**
   * Drop any cached state, stop scanning. Called on user logout.
   */
  reset(): void;
};
