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

/** One sighting of a Playbox-* BLE advertisement during a passive scan. */
export type NearbyStation = {
  stationId: string;
  rssi: number;
  lastSeenAt: number;
};

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
   * Begin a continuous passive scan that fires `onSeen` per advertisement
   * for any Playbox-* device the radio picks up. Used by the map screen
   * to show "nearby" badges before the user taps a station. Caller is
   * responsible for calling `stop()` when the screen loses focus.
   *
   * The driver coordinates with `unlockGate`/`returnGate`/`watchStation`
   * so a targeted scan can briefly take over the radio without the caller
   * needing to stop the passive scan first.
   */
  watchNearbyStations(onSeen: (station: NearbyStation) => void): {
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
    /**
     * 1-indexed physical compartment number, used to derive the BLE HMAC's
     * numeric `gate`. Separate from the reservation-linkage slug below — the
     * physical gate is NOT necessarily the reserved slug's number, and the
     * numeric gate must stay stable regardless of whether a linkage slug is
     * present. When omitted, the driver falls back to parsing the slug for
     * backward compatibility.
     */
    gate?: number;
    /**
     * Reservation-linkage slug (`${stationId}-${sport}-${n}`, the EXACT
     * `reservations.gate_id`). Sent to sign-unlock so the server can link the
     * unlock to a held reservation by exact slug match. OPTIONAL: when the
     * reserved slug isn't reachable, omit it (server skips linkage — a safe
     * no-op) rather than passing a reconstructed guess.
     */
    gateId?: string;
    /** JWT for the active Supabase session — gates verify this server-side. */
    sessionToken: string;
    /** Idempotency key, generated client-side, stable across retries. */
    correlationId: string;
    /**
     * Planned duration in minutes. Signed into the unlock payload and stored
     * on the firmware so the `ball_overdue` event fires at the right time
     * instead of always at the legacy 30-minute default.
     */
    durationMin: number;
  }): Promise<UnlockResult>;

  /**
   * OPTIONAL: pre-sign an unlock in the background (e.g. while the user reads the
   * prep slides) so the eventual `unlockGate` call can skip the sign-unlock
   * round-trip and the door opens sooner. Best-effort and ADDITIVE — `unlockGate`
   * falls back to a fresh fetch if nothing valid is cached, so this can only make
   * unlock faster, never break it. MUST be called with the SAME `correlationId`
   * (and gate/duration/gateId) the later `unlockGate` will use.
   */
  prefetchUnlock?(args: {
    stationId: string;
    gate?: number;
    gateId?: string;
    correlationId: string;
    durationMin: number;
  }): Promise<void>;

  /**
   * Pulse the latch again so the user can put the gear back. Firmware
   * requires the same session_id that was signed at unlock time — caller is
   * responsible for passing what's been persisted on the active session.
   * Same error semantics as `unlockGate`.
   */
  returnGate(args: {
    stationId: string;
    /** 1-indexed compartment number. */
    gate: number;
    /**
     * BLE session id from the original unlock. Must match what the firmware
     * is holding in `activeSessionId[gate-1]` — a mismatch is a silent
     * firmware-side rejection, so we surface it as `auth_rejected`.
     */
    sessionId: string;
    sessionToken: string;
    correlationId: string;
  }): Promise<UnlockResult>;

  /**
   * Drop any cached state, stop scanning. Called on user logout.
   */
  reset(): void;
};
