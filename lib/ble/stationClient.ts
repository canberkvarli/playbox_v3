import { BleManager, Device, Subscription, State } from "react-native-ble-plx";
import { Platform, PermissionsAndroid } from "react-native";
import { Buffer } from "buffer";
import {
  SERVICE_UUID,
  UNLOCK_CHAR_UUID,
  EVENTS_CHAR_UUID,
  INFO_CHAR_UUID,
  encodeCommand,
  decodeEvent,
  type Command,
  type StationEvent,
  type UnlockCommand,
  type ReturnUnlockCommand,
} from "./protocol";

class StationClient {
  private _manager: BleManager | null = null;
  private device: Device | null = null;

  private get manager(): BleManager {
    if (!this._manager) this._manager = new BleManager();
    return this._manager;
  }

  isConnected(): boolean {
    return this.device !== null;
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
        const nameMatches = scanned.name === stationName;
        const uuidMatches = (scanned.serviceUUIDs ?? []).some(
          (u) => u.toLowerCase() === SERVICE_UUID.toLowerCase(),
        );
        if (nameMatches || uuidMatches) {
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

  async scanAndConnect(stationName: string, timeoutMs = 8000): Promise<Device> {
    return new Promise<Device>((resolve, reject) => {
      let settled = false;
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.manager.stopDeviceScan();
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

      this.manager.startDeviceScan(null, null, async (err, scanned) => {
        if (err) {
          finish(() => reject(err));
          return;
        }
        if (scanned?.name === stationName) {
          try {
            const connected = await scanned.connect();
            await connected.discoverAllServicesAndCharacteristics();
            this.device = connected;
            connected.onDisconnected(() => {
              this.device = null;
            });
            finish(() => resolve(connected));
          } catch (e) {
            finish(() => reject(e));
          }
        }
      });
    });
  }

  async writeCommand(cmd: Command): Promise<void> {
    if (!this.device) throw new Error("Not connected to a station");
    const b64 = Buffer.from(encodeCommand(cmd), "utf-8").toString("base64");
    await this.device.writeCharacteristicWithResponseForService(
      SERVICE_UUID,
      UNLOCK_CHAR_UUID,
      b64,
    );
  }

  // Both methods take a pre-signed payload obtained from the `sign-unlock`
  // edge function. The phone is intentionally a dumb pipe — it never
  // computes the HMAC, never holds the station secret. See
  // supabase/functions/sign-unlock for the signing path.
  unlock(payload: UnlockCommand) {
    return this.writeCommand(payload);
  }

  returnUnlock(payload: ReturnUnlockCommand) {
    return this.writeCommand(payload);
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
