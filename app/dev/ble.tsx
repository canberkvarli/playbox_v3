import { Stack } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  PermissionsAndroid,
  Platform,
  ScrollView,
  Share,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { stationClient } from "../../lib/ble/stationClient";
import type { StationEvent } from "../../lib/ble/protocol";
import {
  fetchSignedUnlock,
  fetchSignedReturnUnlock,
} from "../../lib/ble/signUnlock";

const STATION_NAME = "Playbox-DEV-001";
const STATION_ID = "DEV-001";
const TEST_SESSION_ID = "sess-dev-001";
const TEST_DURATION_MIN = 30;

// DEV-001 gate ↔ solenoid ↔ sport (sports array order: football, basketball,
// volleyball → gate 1/2/3 → relay GPIO 13/27/14).
const GATES = [
  { n: 1 as const, label: "⚽ G1" },
  { n: 2 as const, label: "🏀 G2" },
  { n: 3 as const, label: "🏐 G3" },
];

type Status = "idle" | "scanning" | "connected" | "disconnected" | "error";
type LogLine = {
  id: number;
  ts: number;
  kind: "info" | "error" | "event";
  text: string;
};

let logIdCounter = 0;

export default function BleDebugScreen() {
  const [status, setStatus] = useState<Status>("idle");
  const [gate, setGate] = useState<1 | 2 | 3>(1);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const subRef = useRef<{ remove: () => void } | null>(null);

  function log(kind: LogLine["kind"], text: string) {
    setLogs((prev) =>
      [{ id: ++logIdCounter, ts: Date.now(), kind, text }, ...prev].slice(
        0,
        100,
      ),
    );
  }

  async function ensureAndroidPermissions(): Promise<boolean> {
    if (Platform.OS !== "android") return true;
    if (Number(Platform.Version) < 31) {
      const granted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      );
      return granted === PermissionsAndroid.RESULTS.GRANTED;
    }
    const result = await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
    ]);
    return Object.values(result).every(
      (s) => s === PermissionsAndroid.RESULTS.GRANTED,
    );
  }

  async function onConnect() {
    setStatus("scanning");
    log("info", `scanning for "${STATION_NAME}"...`);
    try {
      const ok = await ensureAndroidPermissions();
      if (!ok) {
        log("error", "Bluetooth permissions denied");
        setStatus("error");
        return;
      }
      await stationClient.scanAndConnect(STATION_NAME, 8000);
      setStatus("connected");
      log("info", `connected to ${STATION_NAME}`);

      subRef.current = stationClient.subscribeToEvents(
        (e) => log("event", JSON.stringify(e)),
        (err) => log("error", `notify error: ${err.message}`),
      );
    } catch (e: unknown) {
      // Surface the BleError code (e.g. OperationCancelled=2) so a failed
      // connect is diagnosable from the on-screen log alone.
      const err = e as { message?: string; errorCode?: number; reason?: string };
      const code = err?.errorCode != null ? ` [code ${err.errorCode}]` : "";
      const reason = err?.reason ? ` (${err.reason})` : "";
      const msg = e instanceof Error ? e.message : String(e);
      log("error", `connect failed${code}: ${msg}${reason}`);
      setStatus("error");
    }
  }

  async function onDisconnect() {
    if (subRef.current) {
      subRef.current.remove();
      subRef.current = null;
    }
    await stationClient.disconnect();
    setStatus("disconnected");
    log("info", "disconnected");
  }

  async function onUnlock() {
    try {
      const signed = await fetchSignedUnlock({
        stationId: STATION_ID,
        gate: gate,
        sessionId: TEST_SESSION_ID,
        durationMin: TEST_DURATION_MIN,
        // Dev bench: skip the payment-hold check (server honors this only for
        // DEV-001). Without it sign-unlock returns "no_active_hold".
        devBypass: true,
      });
      await stationClient.unlock(signed);
      log("info", `wrote signed unlock cmd (gate=${gate}, ts=${signed.ts})`);
    } catch (e: unknown) {
      log("error", e instanceof Error ? e.message : String(e));
    }
  }

  async function onReturnUnlock() {
    try {
      const signed = await fetchSignedReturnUnlock({
        stationId: STATION_ID,
        gate: gate,
        sessionId: TEST_SESSION_ID,
        // Dev bench: skip the payment-hold check (DEV-001 only, server-gated).
        devBypass: true,
      });
      await stationClient.returnUnlock(signed);
      log("info", `wrote signed return_unlock cmd (gate=${gate}, ts=${signed.ts})`);
    } catch (e: unknown) {
      log("error", e instanceof Error ? e.message : String(e));
    }
  }

  // Simulate the user shutting the door (stands in for the reed/BOOT press).
  // Advances UNLOCKED→IN_USE after a rent, or RETURN_UNLOCKED→LOCKED after a
  // return — so the whole cycle is drivable from the phone.
  async function onCloseDoor() {
    try {
      await stationClient.simulateClose(gate);
      log("info", `wrote sim_close (gate=${gate}) — simulated door shut`);
    } catch (e: unknown) {
      log("error", e instanceof Error ? e.message : String(e));
    }
  }

  async function onCopyLog() {
    if (logs.length === 0) return;
    // logs are newest-first; reverse to chronological so the paste reads like
    // a serial dump. Share sheet has a "Copy" action (and AirDrop/Messages),
    // so this works without a native clipboard module.
    const text = [...logs]
      .reverse()
      .map((l) => `[${new Date(l.ts).toLocaleTimeString()}] ${l.text}`)
      .join("\n");
    try {
      await Share.share({ message: text });
    } catch {
      // share sheet dismissed — no-op
    }
  }

  useEffect(() => {
    // Adopt an existing shared connection instead of fighting it. This screen
    // and the user-facing flow share the same stationClient singleton; if a
    // link to this station is already held (e.g. you were just testing OYNA),
    // reflect that here and re-subscribe to events — otherwise we'd show "idle"
    // and the Connect button would kick off a competing scan against a
    // peripheral that (being connected) isn't advertising → "connect failed".
    if (
      stationClient.isConnected() &&
      stationClient.connectedName() === STATION_NAME
    ) {
      setStatus("connected");
      log("info", `adopted existing connection to ${STATION_NAME}`);
      subRef.current = stationClient.subscribeToEvents(
        (e) => log("event", JSON.stringify(e)),
        (err) => log("error", `notify error: ${err.message}`),
      );
    }
    // On unmount, only drop OUR event subscription — do NOT disconnect the
    // shared link. This screen used to call stationClient.disconnect() here,
    // which tore down a connection the user-facing flow was holding, causing
    // the "switch screens → connect failed" churn. Use the Disconnect button
    // to tear down on purpose.
    return () => {
      if (subRef.current) {
        subRef.current.remove();
        subRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isConnected = status === "connected";

  return (
    <View className="flex-1 bg-black p-4">
      <Stack.Screen
        options={{
          title: "BLE Debug",
          headerShown: true,
          headerStyle: { backgroundColor: "#000" },
          headerTintColor: "#fff",
        }}
      />

      <Text className="text-white text-lg font-bold mb-1">
        Station: {STATION_NAME}
      </Text>
      <Text className="text-gray-400 mb-3">Status: {status}</Text>

      <View className="flex-row flex-wrap gap-2 mb-3">
        <Btn
          label="Connect"
          onPress={onConnect}
          disabled={isConnected || status === "scanning"}
          primary
        />
        <Btn label="Disconnect" onPress={onDisconnect} disabled={!isConnected} />
        <Btn label="Copy log" onPress={onCopyLog} disabled={logs.length === 0} />
        <Btn label="Clear log" onPress={() => setLogs([])} />
      </View>

      <Text className="text-gray-400 text-xs mb-1">Gate / solenoid</Text>
      <View className="flex-row gap-2 mb-3">
        {GATES.map((g) => (
          <Btn
            key={g.n}
            label={g.label}
            onPress={() => setGate(g.n)}
            primary={gate === g.n}
          />
        ))}
      </View>

      <Text className="text-gray-500 text-xs mb-2">
        Cycle for gate {gate}: Unlock → Close door → Return → Close door{"\n"}
        (Close door = simulate the user shutting it; solenoid {gate} fires on
        Unlock & Return)
      </Text>
      <View className="flex-row flex-wrap gap-2 mb-4">
        <Btn label="1 · Unlock" onPress={onUnlock} disabled={!isConnected} />
        <Btn label="2 · Close door" onPress={onCloseDoor} disabled={!isConnected} />
        <Btn label="3 · Return" onPress={onReturnUnlock} disabled={!isConnected} />
        <Btn label="4 · Close door" onPress={onCloseDoor} disabled={!isConnected} />
      </View>

      <Text className="text-white font-semibold mb-2">
        Event log (newest first)
      </Text>
      <ScrollView className="flex-1 bg-gray-900 rounded p-2">
        {logs.length === 0 && (
          <Text className="text-gray-600 italic">no events yet</Text>
        )}
        {logs.map((l) => (
          <View key={l.id} className="mb-1">
            <Text
              selectable
              className={
                l.kind === "error"
                  ? "text-red-400 font-mono text-xs"
                  : l.kind === "event"
                    ? "text-green-400 font-mono text-xs"
                    : "text-gray-300 font-mono text-xs"
              }
            >
              [{new Date(l.ts).toLocaleTimeString()}] {l.text}
            </Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

function Btn({
  label,
  onPress,
  disabled,
  primary,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  primary?: boolean;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      className={`px-4 py-3 rounded-lg ${
        disabled ? "bg-gray-800" : primary ? "bg-blue-600" : "bg-gray-700"
      }`}
    >
      <Text
        className={`${disabled ? "text-gray-500" : "text-white"} font-medium`}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}
