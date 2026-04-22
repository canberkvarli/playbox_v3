import { Stack } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  PermissionsAndroid,
  Platform,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { stationClient } from "../../lib/ble/stationClient";
import type { StationEvent } from "../../lib/ble/protocol";

const STATION_NAME = "Playbox-DEV-001";
const TEST_SESSION_ID = "sess-dev-001";
const TEST_GATE = 1;
const TEST_DURATION_MIN = 30;

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
      const msg = e instanceof Error ? e.message : String(e);
      log("error", msg);
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
      await stationClient.unlock(
        TEST_GATE,
        TEST_SESSION_ID,
        TEST_DURATION_MIN,
      );
      log("info", `wrote unlock cmd (gate=${TEST_GATE})`);
    } catch (e: unknown) {
      log("error", e instanceof Error ? e.message : String(e));
    }
  }

  async function onReturnUnlock() {
    try {
      await stationClient.returnUnlock(TEST_GATE, TEST_SESSION_ID);
      log("info", `wrote return_unlock cmd (gate=${TEST_GATE})`);
    } catch (e: unknown) {
      log("error", e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    return () => {
      if (subRef.current) subRef.current.remove();
      stationClient.disconnect();
    };
  }, []);

  const isConnected = status === "connected";

  return (
    <View className="flex-1 bg-black p-4">
      <Stack.Screen
        options={{
          title: "BLE Debug",
          headerStyle: { backgroundColor: "#000" },
          headerTintColor: "#fff",
        }}
      />

      <Text className="text-white text-lg font-bold mb-1">
        Station: {STATION_NAME}
      </Text>
      <Text className="text-gray-400 mb-4">Status: {status}</Text>

      <View className="flex-row flex-wrap gap-2 mb-4">
        <Btn
          label="Connect"
          onPress={onConnect}
          disabled={isConnected || status === "scanning"}
          primary
        />
        <Btn label="Disconnect" onPress={onDisconnect} disabled={!isConnected} />
        <Btn label="Fake Unlock" onPress={onUnlock} disabled={!isConnected} />
        <Btn
          label="Fake Return-Unlock"
          onPress={onReturnUnlock}
          disabled={!isConnected}
        />
        <Btn label="Clear Log" onPress={() => setLogs([])} />
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
      className={`px-4 py-2 rounded ${
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
