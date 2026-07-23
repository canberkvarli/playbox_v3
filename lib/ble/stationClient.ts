import { BleManager, Device, Subscription, State } from "react-native-ble-plx";
import { Platform, PermissionsAndroid } from "react-native";
import { Buffer } from "buffer";
import {
  SERVICE_UUID,
  UNLOCK_CHAR_UUID,
  EVENTS_CHAR_UUID,
  INFO_CHAR_UUID,
  BUFFER_CHAR_UUID,
  encodeCommand,
  decodeEvent,
  type Command,
  type AnyCommand,
  type AckCommand,
  type StationEvent,
  type UnlockCommand,
  type ReturnUnlockCommand,
} from "./protocol";
import { backoffSchedule, classifyBleError, jitter } from "./retry";
import type { BtState } from "./btState";

class StationClient {
  private _manager: BleManager | null = null;
  private device: Device | null = null;
  // Last advertising packet our proximity watcher saw — lets the unlock
  // flow connect without restarting the scan. iOS only allows one active
  // BLE scan at a time, so when proximity + unlock try to scan in parallel
  // they fight; using the watcher's already-known device avoids that.
  private lastSeenDevice: Device | null = null;

  // Passive scan that emits any "Playbox-*" advert it sees, used by the
  // map screen to show "nearby" badges before the user taps a station.
  // Only one passive scan can run at a time, and scanAndConnect will
  // pause it (iOS allows one active scan); we restart it automatically
  // once the targeted scan finishes.
  private passiveScan: {
    onSeen: (name: string, rssi: number) => void;
    onError?: (err: Error) => void;
  } | null = null;
  private passiveScanActive = false;
  // Single-flight guard for scanAndConnect. When the eager prep-screen watcher
  // is mid-connect and the user taps OYNA, both call scanAndConnect on this same
  // singleton — two concurrent connects on iOS cancel each other ("operation was
  // cancelled", code 2). We dedupe: a second connect to the SAME station awaits
  // the in-flight one instead of racing it.
  private connectInFlight: { name: string; promise: Promise<Device> } | null = null;
  // Watches the BLE adapter power state. Without it, a passive scan started
  // while the adapter is off (user opens the map, THEN enables Bluetooth)
  // errors out and never retries — the station stays grayed until a fresh scan
  // from another screen. The watcher restarts the passive scan on PoweredOn.
  private stateSub: Subscription | null = null;

  private get manager(): BleManager {
    if (!this._manager) this._manager = new BleManager();
    return this._manager;
  }

  isConnected(): boolean {
    return this.device !== null;
  }

  /**
   * Name of the station we currently hold a live GATT connection to, or null
   * if not connected. Lets callers check presence for a SPECIFIC station
   * without leaking the Device handle. The name check matters for the same
   * reason `scanAndConnect` guards on it: being connected to the DEV-001
   * breadboard must never count as presence for ist-taksim.
   */
  connectedName(): string | null {
    return this.device?.name ?? null;
  }

  /**
   * Advertisement-only watcher — fires `onSeen` every time the station's BLE
   * advertisement is received, without establishing a connection or running
   * service discovery. This is what proximity UI should use: detection is
   * 5–10x faster than scanAndConnect because we skip the GATT handshake.
   *
   * Returns a `.stop()` handle. Caller is responsible for calling it on
   * unmount.
   *
   * Note: react-native-ble-plx only supports one active scan at a time. If
   * `scanAndConnect` is called while a watch is running, the watch's scan
   * will be replaced. UI flows should call `stop()` first if they're about
   * to initiate an unlock.
   */
  watchAdvertisements(
    stationName: string,
    onSeen: (rssi: number) => void,
    onError?: (err: Error) => void,
  ): { stop: () => void } {
    let stopped = false;
    // - allowDuplicates: iOS otherwise dedupes the scan-callback to one
    //   fire per device, so we'd miss the scan-response packet (which is
    //   where the name lives — NimBLE puts the 128-bit service UUID in
    //   the primary advert and pushes the name into the scan response
    //   because they don't both fit in 31 bytes). With duplicates on we
    //   get every packet and detect on whichever arrives first.
    // - No service-UUID filter: see the above; the UUID is in the primary
    //   but iOS's filter is moody about that on some builds. Matching
    //   client-side on name OR UUID is more reliable.
    this.manager.startDeviceScan(
      null,
      { allowDuplicates: true },
      (err, scanned) => {
        if (stopped) return;
        if (err) {
          onError?.(err);
          return;
        }
        if (!scanned) return;
        // Match strictly by name. Service-UUID matching was a false-positive
        // because every breadboard ESP32 broadcasts the same SERVICE_UUID;
        // matching on that meant ist-taksim (and every other Istanbul
        // station) showed "in range" when the dev unit was nearby. With
        // allowDuplicates on, iOS gives us the scan-response packets too —
        // those contain the local name even when NimBLE has pushed it out
        // of the primary advert due to the 31-byte budget.
        if (scanned.name === stationName) {
          this.lastSeenDevice = scanned;
          onSeen(scanned.rssi ?? -55);
        }
      },
    );
    return {
      stop: () => {
        if (stopped) return;
        stopped = true;
        try {
          this.manager.stopDeviceScan();
        } catch {
          // already stopped or not started — ignore
        }
      },
    };
  }

  /**
   * Begin a continuous passive scan that fires `onSeen(name, rssi)` for any
   * device advertising a name beginning with "Playbox-". Caller is expected
   * to filter/translate the name into a known station ID. Idempotent — calling
   * twice replaces the previous callbacks. `stopPassiveScan()` ends it.
   *
   * Coordinated with scanAndConnect: when a targeted scan starts, the OS scan
   * is stopped; we restart the passive scan automatically once the targeted
   * scan settles (whether it connected or timed out).
   */
  startPassiveScan(
    onSeen: (name: string, rssi: number) => void,
    onError?: (err: Error) => void,
  ): void {
    this.passiveScan = { onSeen, onError };
    this.armStateWatcher();
    this.runPassiveScan();
  }

  /**
   * Restart the passive scan whenever the BLE adapter (re)enters PoweredOn —
   * covers "enabled Bluetooth while already on the map" and iOS dropping the
   * scan during a state handoff. Idempotent; torn down in stopPassiveScan /
   * destroy. `emitCurrentState=true` kicks a scan the moment the adapter is
   * ready even if it was off at mount.
   */
  private armStateWatcher(): void {
    if (this.stateSub) return;
    this.stateSub = this.manager.onStateChange((state) => {
      if (state === State.PoweredOn) {
        // Only resume passive scanning when we DON'T already hold a live GATT
        // link — scanning while connected can wedge the radio.
        if (this.passiveScan && !this.device) this.runPassiveScan();
      } else {
        // Adapter unusable → mark inactive so the next PoweredOn restarts it.
        this.passiveScanActive = false;
      }
    }, true);
  }

  stopPassiveScan(): void {
    this.passiveScan = null;
    if (this.stateSub) {
      this.stateSub.remove();
      this.stateSub = null;
    }
    if (this.passiveScanActive) {
      this.passiveScanActive = false;
      try {
        this.manager.stopDeviceScan();
      } catch {
        // already stopped — ignore
      }
    }
  }

  /**
   * Fully release the native BleManager / CBCentralManager.
   *
   * MUST be called before `Updates.reloadAsync()`. A JS reload re-runs this
   * module and lazily creates a SECOND native BleManager while the pre-reload
   * one still lives — two live CoreBluetooth managers wedge the radio so BLE
   * becomes unreachable until the OS process is killed. That's the root cause
   * of "have to reinstall after every OTA / new build": a reinstall was the
   * only path with no reload. Destroying here lets the post-reload manager
   * initialize from a clean slate. The `_manager` getter recreates lazily on
   * next use, so this is safe to call even if BLE is used again afterwards.
   */
  destroy(): void {
    this.passiveScan = null;
    this.passiveScanActive = false;
    if (this.stateSub) {
      this.stateSub.remove();
      this.stateSub = null;
    }
    this.device = null;
    this.lastSeenDevice = null;
    if (this._manager) {
      try {
        // destroy() natively stops scans + cancels all connections.
        this._manager.destroy();
      } catch {
        // best-effort — we're tearing down anyway
      }
      this._manager = null;
    }
  }

  private runPassiveScan(): void {
    if (!this.passiveScan) return;
    if (this.passiveScanActive) return;
    const { onSeen, onError } = this.passiveScan;
    this.passiveScanActive = true;
    try {
      this.manager.startDeviceScan(
        null,
        { allowDuplicates: true },
        (err, scanned) => {
          if (err) {
            // Reset the active flag so the state watcher / next call can
            // restart — otherwise a transient scan error wedges it "active"
            // forever and presence never recovers while the screen stays open.
            this.passiveScanActive = false;
            onError?.(err);
            return;
          }
          if (!scanned?.name) return;
          // Cheap prefix check — saves a per-station regex per packet.
          if (!scanned.name.startsWith('Playbox-')) return;
          this.lastSeenDevice = scanned;
          onSeen(scanned.name, scanned.rssi ?? -70);
        },
      );
    } catch (e) {
      this.passiveScanActive = false;
      onError?.(e as Error);
    }
  }

  async scanAndConnect(stationName: string, timeoutMs = 8000): Promise<Device> {
    // Single-flight: if a connect to this SAME station is already running (the
    // eager prep-screen watcher started one and the user just tapped OYNA),
    // await THAT connection instead of starting a second, competing scan/connect
    // — concurrent connects cancel each other on iOS ("operation was cancelled").
    // A live-handle fast return is cheap, so only dedupe when nothing is
    // connected yet; a different station name always runs fresh.
    if (
      this.connectInFlight &&
      this.connectInFlight.name === stationName &&
      !this.device
    ) {
      return this.connectInFlight.promise;
    }
    const promise = this._scanAndConnectWithRetry(stationName, timeoutMs);
    this.connectInFlight = { name: stationName, promise };
    try {
      return await promise;
    } finally {
      if (this.connectInFlight?.promise === promise) this.connectInFlight = null;
    }
  }

  /**
   * iOS BLE cold-connect is flaky: the first scan/connect after the radio warms
   * up — or after a scan-teardown race — routinely misses, so the user ends up
   * tapping 2–3 times to land one connection. Give a SINGLE tap up to
   * MAX_ATTEMPTS internal shots: on failure we drop stale handles so the retry
   * does a clean fresh scan, then let CoreBluetooth settle before trying again.
   * We stop early on a terminal adapter state (off / unauthorized) — retrying
   * there just burns another 8s timeout and delays the error the user needs.
   */
  private async _scanAndConnectWithRetry(
    stationName: string,
    timeoutMs: number,
  ): Promise<Device> {
    const MAX_ATTEMPTS = 2;
    let lastErr: unknown;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        return await this._doScanAndConnect(stationName, timeoutMs);
      } catch (e) {
        lastErr = e;
        // Terminal adapter state → surface the error now, don't retry.
        const st = await this.manager.state().catch(() => null);
        if (st && st !== State.PoweredOn) break;
        if (attempt < MAX_ATTEMPTS) {
          // Clear stale handles so the next attempt scans fresh (a dead
          // lastSeenDevice would just fail the fast path again), then let iOS
          // finish tearing the scan down + settle the radio before retrying.
          this.device = null;
          this.lastSeenDevice = null;
          await new Promise((r) => setTimeout(r, 500));
        }
      }
    }
    throw lastErr;
  }

  private async _doScanAndConnect(
    stationName: string,
    timeoutMs = 8000,
  ): Promise<Device> {
    // Already connected to the SAME device? Hand back the live handle.
    // The name check is critical — without it, opening ist-taksim while
    // connected to the DEV-001 breadboard would falsely report in_range
    // for ist-taksim too.
    if (this.device && this.device.name === stationName) {
      // Verify the cached handle is actually still connected. If the ESP32
      // rebooted or the link dropped without onDisconnected firing, this handle
      // is dead — returning it makes the caller think it's connected while
      // every write fails. Re-scan instead of trusting a stale handle.
      try {
        if (await this.device.isConnected()) return this.device;
      } catch {
        // isConnected threw → treat as dead
      }
      this.device = null;
    }

    // Connected to a DIFFERENT station than the one requested? Release that link
    // first. We can't cleanly hold two GATT connections through this manager, and
    // leaving the old one open makes the new connect die with "operation was
    // cancelled". This is the "one screen holds station A, another asks for
    // station B" case (e.g. debug screen vs. the user-facing flow).
    if (this.device && this.device.name !== stationName) {
      try {
        await this.disconnect();
      } catch {
        // best-effort — fall through and try the fresh connect anyway
      }
    }

    // Stop any active scan UP FRONT — iOS cancels a connect that begins while a
    // scan is still running ("operation was cancelled"). This started biting
    // once the passive scan actually worked (a live scan now collides with the
    // connect). Remember whether it was on so we can resume it if we don't end
    // up holding a link.
    const passiveWasActive = this.passiveScanActive;
    this.passiveScanActive = false;
    try {
      this.manager.stopDeviceScan();
    } catch {
      // already stopped — ignore
    }
    // iOS tears a scan down ASYNCHRONOUSLY. A connect() issued in the same tick
    // as stopDeviceScan() routinely dies with "operation was cancelled"
    // (BleError code 2) — this is the classic "first tap fails, second works"
    // bug. A short settle lets CoreBluetooth finish stopping the scan before we
    // connect. Only pay it when a scan was actually running.
    if (passiveWasActive) {
      await new Promise((r) => setTimeout(r, 250));
    }

    // Fast path: if the proximity watcher recently saw this device, just
    // connect to it. No second scan, no iOS scan-collision, no waiting
    // for the next advert packet — should be under a second.
    if (this.lastSeenDevice && this.lastSeenDevice.name === stationName) {
      try {
        // Bound the connect: a stale lastSeenDevice (previous session, or an
        // ESP32 that rebooted since we saw its advert) can hang connect()
        // indefinitely with no timeout, freezing the caller (e.g. the BLE
        // debug screen stuck on "scanning"). On timeout we fall through to a
        // fresh scan below.
        const connected = await this.lastSeenDevice.connect({ timeout: 6000 });
        await connected.discoverAllServicesAndCharacteristics();
        this.device = connected;
        connected.onDisconnected(() => {
          this.device = null;
          // Clear the cached handle too — after a disconnect (especially
          // if the ESP32 rebooted), the cached Device may be stale and
          // re-using it for the fast path will just fail again. Force a
          // fresh scan on the next attempt.
          this.lastSeenDevice = null;
          // A held link dropping (e.g. after the eager prep-screen connect or an
          // idle timeout) must NOT leave the map blind. Resume the passive scan
          // so presence recovers on its own — otherwise the station shows
          // "kapalı" until the user toggles Bluetooth. No-op if the map isn't
          // scanning; skipped while a reconnect owns the radio.
          if (!this.connectInFlight) this.runPassiveScan();
        });
        await this.syncTimeBestEffort();
        return connected;
      } catch {
        // Fall back to the full scan — fast path is best-effort.
        this.lastSeenDevice = null;
      }
    }

    // Slow path: run a fresh scan targeted at this device name. (Any prior scan
    // was already stopped up front, above.)
    return new Promise<Device>((resolve, reject) => {
      let settled = false;
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try {
          this.manager.stopDeviceScan();
        } catch {
          // ignore
        }
        // Resume the passive scan if it was paused AND we didn't end up holding
        // a link — keeps the map's badges live without scanning while connected
        // (which can wedge the radio).
        if (passiveWasActive && this.passiveScan && !this.device) {
          this.runPassiveScan();
        }
        fn();
      };

      const timer = setTimeout(
        () =>
          finish(() =>
            reject(
              new Error(
                `Timeout: "${stationName}" not found within ${timeoutMs}ms`,
              ),
            ),
          ),
        timeoutMs,
      );

      // allowDuplicates is REQUIRED here, same as the passive/proximity scans
      // (see the comment at runPassiveScan): on iOS an un-duplicated scan
      // dedupes to a single callback carrying only the PRIMARY advert — which
      // holds the service UUID but NOT the name (NimBLE pushes the name into
      // the scan-response packet, since both don't fit in 31 bytes). Without
      // this flag `scanned.name` is empty, `scanned.name === stationName` never
      // matches, and every slow-path connect (e.g. the BLE debug screen, or any
      // connect after an ESP32 reboot) times out at `timeoutMs`.
      let connecting = false;
      this.manager.startDeviceScan(null, { allowDuplicates: true }, async (err, scanned) => {
        if (settled || connecting) return;
        if (err) {
          finish(() => reject(err));
          return;
        }
        if (scanned?.name === stationName) {
          // Stop the scan BEFORE connecting — iOS cancels an in-flight connect
          // if a scan is still active ("operation was cancelled"). `connecting`
          // guards the allowDuplicates callback from firing again mid-connect.
          connecting = true;
          try {
            this.manager.stopDeviceScan();
          } catch {
            // ignore
          }
          // Settle before connecting: same iOS async-scan-teardown race as the
          // fast path above — connecting in the same tick as the scan stop gets
          // cancelled ("operation was cancelled", code 2). This is the single
          // biggest cause of the slow-path first-try failure.
          await new Promise((r) => setTimeout(r, 250));
          try {
            const connected = await scanned.connect({ timeout: 8000 });
            await connected.discoverAllServicesAndCharacteristics();
            this.device = connected;
            this.lastSeenDevice = scanned;
            connected.onDisconnected(() => {
              this.device = null;
              this.lastSeenDevice = null;
              // Resume the passive scan so map/station presence recovers without
              // a Bluetooth toggle (see fast-path note). Skipped mid-reconnect.
              if (!this.connectInFlight) this.runPassiveScan();
            });
            await this.syncTimeBestEffort();
            finish(() => resolve(connected));
          } catch (e) {
            finish(() => reject(e));
          }
        }
      });
    });
  }

  // Accepts the wider `AnyCommand` (signable commands plus the UNSIGNED
  // set_time / ack) — it only JSON-encodes + writes, so widening is safe.
  async writeCommand(cmd: AnyCommand): Promise<void> {
    if (!this.device) throw new Error("Not connected to a station");
    const b64 = Buffer.from(encodeCommand(cmd), "utf-8").toString("base64");
    await this.device.writeCharacteristicWithResponseForService(
      SERVICE_UUID,
      UNLOCK_CHAR_UUID,
      b64,
    );
  }

  /**
   * Anchor the station's wall clock right after connecting, so every event it
   * emits carries a real timestamp instead of raw seconds-since-boot. Sent once
   * per connection (which means it also re-anchors after an ESP32 reboot, since
   * a reboot drops the link → we reconnect → this fires again).
   *
   * The `now` is NON-AUTHORITATIVE — the server never bills on wall_ts (see
   * protocol.ts); this is purely for legible audit/event logs. Best-effort and
   * never throws: a failed set_time only costs timestamp readability, so it must
   * not block (or fail) a connect/unlock.
   */
  private async syncTimeBestEffort(): Promise<void> {
    try {
      await this.writeCommand({
        cmd: "set_time",
        now: Math.floor(Date.now() / 1000),
      });
    } catch {
      // best-effort — events just stay uptime-relative until the next connect
    }
  }

  /**
   * Read the station's pending SIGNED-event gossip buffer (Phase 3 Task 8).
   *
   * FIRMWARE-GATED: the BUFFER characteristic is Phase 0 firmware Task 5 and
   * does NOT exist yet, so the read will throw on today's firmware — we CATCH
   * and return [] so the gossip drain is a safe no-op. Once the firmware
   * exposes BUFFER_CHAR_UUID returning a JSON array of buffered events, this
   * lights up automatically (the caller filters via `planGossipDrain`).
   *
   * Best-effort + non-throwing by contract: any failure → [].
   */
  async readPendingBuffer(): Promise<unknown[]> {
    if (!this.device) return [];
    try {
      const char = await this.device.readCharacteristicForService(
        SERVICE_UUID,
        BUFFER_CHAR_UUID,
      );
      if (!char.value) return [];
      const parsed = JSON.parse(
        Buffer.from(char.value, "base64").toString("utf-8"),
      );
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      // No BUFFER characteristic yet (firmware Task 5) or malformed → no-op.
      return [];
    }
  }

  /**
   * Write the UNSIGNED `ack` command back to the station so it can drop
   * buffered events ≤ seq (Phase 3 Task 8). FIRMWARE-GATED: the firmware ack
   * handler is Phase 0 Task 5 — until then this either errors (caught) or is a
   * harmless write the firmware ignores. Best-effort + non-throwing: any
   * failure → swallowed. A lost ack is advisory — the station just re-sends.
   */
  async writeAck(ack: AckCommand): Promise<void> {
    if (!this.device) return;
    try {
      await this.writeCommand(ack);
    } catch {
      // No ack handler yet (firmware Task 5) → no-op.
    }
  }

  /**
   * Write `cmd` with a bounded exponential-backoff+jitter retry, but ONLY for
   * transient failures (GATT/connection/timeout). Terminal failures — radio
   * off, unauthorized, signature rejected, or anything unrecognized — rethrow
   * immediately so the UI's `classifyError` mapping still fires with the right
   * localized prompt (retrying those would just hammer the radio / firmware).
   *
   * The pure retry policy lives in ./retry (Jest-tested). Math.random is only
   * called HERE, at the call site, to feed the jitter fraction — the policy
   * module stays deterministic. If the link dropped mid-write
   * (`this.device` cleared by onDisconnected), we re-scan/reconnect by name
   * before the next attempt, mirroring the proximity reconnect path; the fresh
   * handshake runs discoverAllServicesAndCharacteristics so the next write
   * targets a valid characteristic.
   */
  private async writeCommandWithRetry(
    cmd: Command,
    stationName?: string,
  ): Promise<void> {
    const delays = backoffSchedule();
    // Total attempts = 1 initial + delays.length retries.
    for (let attempt = 0; ; attempt++) {
      try {
        await this.writeCommand(cmd);
        return;
      } catch (e) {
        const cls = classifyBleError(e);
        const retriesLeft = attempt < delays.length;
        if (cls !== "retryable" || !retriesLeft) {
          // Terminal, or out of attempts — let the caller/UI handle it.
          throw e;
        }
        // Jitter fraction from real RNG (kept out of the pure module).
        const wait = jitter(delays[attempt], Math.random());
        await new Promise((r) => setTimeout(r, wait));
        // If the link dropped, re-establish the device handle before retrying.
        if (!this.device) {
          const name = stationName ?? this.lastSeenDevice?.name;
          if (name) {
            try {
              await this.scanAndConnect(name);
              // Re-read INFO to confirm the reconnected handle is live, matching
              // how the proximity layer revalidates after a reconnect.
              await this.readInfo().catch(() => {});
            } catch {
              // Reconnect failed this round — fall through and retry the write,
              // which will throw "Not connected" and be re-classified.
            }
          }
        }
      }
    }
  }

  // Both methods take a pre-signed payload obtained from the `sign-unlock`
  // edge function. The phone is intentionally a dumb pipe — it never
  // computes the HMAC, never holds the station secret. See
  // supabase/functions/sign-unlock for the signing path. Public API unchanged:
  // same signature/return; the retry is internal.
  unlock(payload: UnlockCommand, stationName?: string) {
    return this.writeCommandWithRetry(payload, stationName);
  }

  returnUnlock(payload: ReturnUnlockCommand, stationName?: string) {
    return this.writeCommandWithRetry(payload, stationName);
  }

  /**
   * DEV ONLY — simulate the reed/door-closed edge from the app (a fake-reed
   * stand-in for the dev board's BOOT button), so the BLE debug screen can drive
   * the full rent→close→return→close cycle on-phone. Honored only by firmware
   * built with DEV_SIM_CLOSE (single-gate dev unit); production firmware ignores
   * it. Unsigned + best-effort: it only advances local door state, never opens
   * the gate.
   */
  simulateClose(gate: number) {
    return this.writeCommand({ cmd: "sim_close", gate });
  }

  subscribeToEvents(
    onEvent: (event: StationEvent) => void,
    onError?: (err: Error) => void,
  ): Subscription {
    if (!this.device) throw new Error("Not connected to a station");
    return this.device.monitorCharacteristicForService(
      SERVICE_UUID,
      EVENTS_CHAR_UUID,
      (err, char) => {
        if (err) {
          onError?.(err);
          return;
        }
        if (!char?.value) return;
        try {
          const json = Buffer.from(char.value, "base64").toString("utf-8");
          onEvent(decodeEvent(json));
        } catch (e) {
          onError?.(e as Error);
        }
      },
    );
  }

  async readInfo(): Promise<unknown> {
    if (!this.device) throw new Error("Not connected to a station");
    const char = await this.device.readCharacteristicForService(
      SERVICE_UUID,
      INFO_CHAR_UUID,
    );
    if (!char.value) throw new Error("INFO characteristic returned no value");
    return JSON.parse(Buffer.from(char.value, "base64").toString("utf-8"));
  }

  /**
   * Read the LIVE Bluetooth adapter state for a pre-flight gate. ble-plx's
   * `State` enum values are the same strings as our `BtState` union
   * (`'PoweredOn'`, `'PoweredOff'`, ...), so we forward the raw value. If
   * the read throws (e.g. manager not yet ready), report `Unknown` —
   * `canAttemptBle` maps that to the `transient` "tekrar dene" path rather
   * than a misleading "turn on Bluetooth".
   */
  async currentState(): Promise<BtState> {
    try {
      const state = await this.manager.state();
      return state as BtState;
    } catch {
      return "Unknown";
    }
  }

  async disconnect(): Promise<void> {
    if (!this.device) return;
    try {
      await this.device.cancelConnection();
    } catch {
      // already disconnected, ignore
    }
    this.device = null;
  }

  /**
   * Trigger the OS Bluetooth permission prompt and resolve to the result.
   *
   * iOS: instantiating the BleManager (via the lazy getter) creates the
   * underlying CBCentralManager which surfaces the system alert the first
   * time the app uses BLE. We observe `onStateChange` and resolve once it
   * settles. PoweredOn/PoweredOff both mean "permission granted" — we don't
   * gate onboarding on the radio being currently on, just on the user
   * having said yes to the prompt.
   *
   * Android: runtime permission request via `PermissionsAndroid`. On
   * Android 12+ we ask for BLUETOOTH_SCAN + BLUETOOTH_CONNECT; on older
   * versions BLE scanning piggy-backs on ACCESS_FINE_LOCATION.
   */
  async requestPermission(): Promise<"granted" | "denied"> {
    if (Platform.OS === "android") {
      try {
        if (Number(Platform.Version) >= 31) {
          const r = await PermissionsAndroid.requestMultiple([
            PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
            PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
          ]);
          const ok = Object.values(r).every(
            (s) => s === PermissionsAndroid.RESULTS.GRANTED,
          );
          return ok ? "granted" : "denied";
        }
        const r = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        );
        return r === PermissionsAndroid.RESULTS.GRANTED ? "granted" : "denied";
      } catch {
        return "denied";
      }
    }
    if (Platform.OS !== "ios") return "denied";

    return new Promise((resolve) => {
      let done = false;
      let sub: Subscription | null = null;
      const finish = (result: "granted" | "denied") => {
        if (done) return;
        done = true;
        try {
          sub?.remove();
        } catch {}
        resolve(result);
      };
      sub = this.manager.onStateChange((state) => {
        if (state === State.PoweredOn) finish("granted");
        else if (state === State.PoweredOff) finish("granted");
        else if (state === State.Unauthorized) finish("denied");
        else if (state === State.Unsupported) finish("denied");
      }, true);
      // Safety net — if the state never settles, fail closed.
      setTimeout(() => finish("denied"), 10_000);
    });
  }
}

export const stationClient = new StationClient();
