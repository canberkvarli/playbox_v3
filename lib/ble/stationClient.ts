import { BleManager, Device, Subscription } from "react-native-ble-plx";
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

  unlock(gate: number, sessionId: string, durationMin: number) {
    return this.writeCommand({
      cmd: "unlock",
      gate,
      session_id: sessionId,
      duration_min: durationMin,
    });
  }

  returnUnlock(gate: number, sessionId: string) {
    return this.writeCommand({
      cmd: "return_unlock",
      gate,
      session_id: sessionId,
    });
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
}

export const stationClient = new StationClient();
