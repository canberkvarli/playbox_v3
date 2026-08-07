import { useCallback, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';

import { stationClient } from '@/lib/ble/stationClient';
import { extractDoor, type DoorState } from './infoGate';

/**
 * How often to re-read INFO for the door position. The reed itself is instant;
 * this is only how fast we notice. 4s keeps the "kapıyı aç" button honest
 * within a beat of the user shutting the door, at one small read per tick on a
 * link we are already holding.
 */
const POLL_MS = 4000;

/**
 * Live physical door state for one gate, read off the reed switch via INFO.
 *
 * DELIBERATELY PASSIVE. It never scans and never opens a GATT link — it reads
 * ONLY when a link already happens to be up (the foreground link session-prep
 * left open after the unlock). With no link it reports 'unknown' and the caller
 * falls back to whatever it did before. This is the standing rule: presence
 * never connects, and a held link makes the station invisible to everyone else
 * because a connected ESP32 stops advertising.
 *
 * Returns 'unknown' — never a guess — when there's no link, when the read
 * fails, or when the gate has no reed wired (firmware reports "unknown" for
 * those, and gate 2/3 are unwired today). Callers MUST treat 'unknown'
 * permissively: it means "we don't know", not "the door is open".
 */
export function useDoorState(gate: number | null, enabled: boolean): DoorState {
  const [door, setDoor] = useState<DoorState>('unknown');
  // Read guard: a slow read must not stack behind the interval and queue up
  // overlapping GATT reads on the same characteristic.
  const inFlight = useRef(false);

  // ON FOCUS, not on mount. play.tsx is a TAB screen: it mounts once and stays
  // mounted forever, so a plain useEffect kept firing a GATT read every 4s from
  // a screen the user had navigated away from — including while session-prep
  // was running an unlock on the very same radio. A status poll must never be
  // in the way of the one operation the user is actually waiting on.
  useFocusEffect(
    useCallback(() => {
      if (!enabled || !gate) {
        setDoor('unknown');
        return;
      }
      let cancelled = false;

      const tick = async () => {
        if (cancelled || inFlight.current) return;
        // Backgrounded: iOS is about to suspend us (and backgroundLinkRelease is
        // tearing the link down anyway) — don't burn a read on a dying handle.
        if (AppState.currentState !== 'active') return;
        // A connect/reconnect owns the radio. Reading now would land on a
        // handle mid-teardown and can leave iOS holding a phantom link, which
        // is far worse than not knowing the door position for 4 more seconds.
        if (stationClient.isBusy()) return;
        // The ONLY gate on connecting: if we aren't already connected, we stay
        // ignorant rather than opening a link for a status read.
        if (!stationClient.isConnected()) {
          if (!cancelled) setDoor('unknown');
          return;
        }
        inFlight.current = true;
        try {
          const info = await stationClient.readInfo();
          if (!cancelled) setDoor(extractDoor(info, gate));
        } catch {
          // Stale handle, mid-reconnect, or the board is busy. Not knowing is a
          // valid answer here — fall back to 'unknown' and try again next tick.
          if (!cancelled) setDoor('unknown');
        } finally {
          inFlight.current = false;
        }
      };

      void tick();
      const id = setInterval(tick, POLL_MS);
      return () => {
        cancelled = true;
        clearInterval(id);
      };
    }, [gate, enabled]),
  );

  return door;
}
