import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Linking, Platform, Pressable, Text, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';

import { useT } from '@/hooks/useT';
import { hx } from '@/lib/haptics';
import { palette } from '@/constants/theme';
import { CITY_LABELS, STATIONS, type Station, type Sport } from '@/data/stations.seed';
import { useMapStore } from '@/stores/mapStore';
import { useFreshPresence, useNearbyStore } from '@/stores/nearbyStore';
import { getDriver } from '@/lib/hardware';
import { useSessionStore } from '@/stores/sessionStore';
import { useDevStore } from '@/stores/devStore';
import { useIsDeveloper } from '@/hooks/useIsDeveloper';
import { StationGateSelector } from '@/components/StationGateSelector';
import { useGuardedPress } from '@/hooks/useGuardedPress';
import { stationClient } from '@/lib/ble/stationClient';
import { fetchSignedUnlock, fetchSignedReturnUnlock } from '@/lib/ble/signUnlock';
import { DirectionsSheet } from '@/components/DirectionsSheet';

export default function StationDetail() {
  const { t } = useT();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  // Developer account? Reveals the bench servo controls even in release builds.
  const isDeveloper = useIsDeveloper();

  const lastSelected = useMapStore((s) => s.lastSelectedStation);
  const startSession = useSessionStore((s) => s.startSession);

  const [unlocking, setUnlocking] = useState(false);

  // Collapsing header: track scroll offset on the UI thread and drive the
  // mini-title's opacity/translate from it. The big title sits ~36px down in
  // the scroll content (paddingTop 24 + its own height), so it has fully
  // scrolled past the fixed header bar by ~70-100px of offset.
  const scrollY = useSharedValue(0);
  const scrollHandler = useAnimatedScrollHandler((e) => {
    scrollY.value = e.contentOffset.y;
  });

  const miniTitleStyle = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.value, [60, 100], [0, 1], Extrapolation.CLAMP),
    transform: [
      {
        translateY: interpolate(scrollY.value, [60, 100], [8, 0], Extrapolation.CLAMP),
      },
    ],
  }));

  const bigTitleStyle = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.value, [40, 90], [1, 0], Extrapolation.CLAMP),
  }));

  // The location line and the mini title share the same centered header slot
  // (mini title is absolutely positioned over the location line). Fade the
  // location OUT exactly as the mini title fades IN so the two never overlap.
  const locationStyle = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.value, [60, 100], [1, 0], Extrapolation.CLAMP),
  }));

  const station: Station | null = useMemo(() => {
    if (lastSelected && lastSelected.id === id) return lastSelected;
    return STATIONS.find((s) => s.id === id) ?? null;
  }, [id, lastSelected]);

  // Keep a passive BLE scan alive while this screen is open. The proximity
  // CTA (OYNA / "kontrol ediliyor") is driven by watchStation, which prefers
  // a fresh advert *sighting* over holding a fragile GATT connection. Without
  // a scan here those sightings go stale within ~10s (the map's scan stopped
  // on blur), forcing watchStation onto the connection-based path that keeps
  // dropping — the flicker. Feeding nearbyStore here keeps presence stable and
  // advert-based, exactly like the map's green dot; the real unlock still
  // connects on tap (via scanAndConnect's lastSeenDevice fast path).
  // Feed the nearby store from this screen too, so the header presence stays
  // advert-based and stable. Scoped to focus (stops on blur) so it never scans
  // while the unlock/return flow holds a GATT connection — an always-on scan
  // scanning mid-connection wedged the radio.
  // Once we've HEARD the station we're in the radius — so stop the nearby-scan
  // and stop competing with our own connect. A scan running when we tap makes
  // iOS cancel the connect ("operation was cancelled"); the debug screen
  // connects first-try precisely because it runs no scan. So: scan only until
  // presence is confirmed, then latch "in range", stop scanning, and let the
  // tap connect immediately — scanAndConnect's fast path reuses the device we
  // just heard, so there's no fresh scan and no contention. Re-arms on refocus.
  const scanSubRef = useRef<{ stop: () => void } | null>(null);
  const [presenceLatched, setPresenceLatched] = useState(false);
  useFocusEffect(
    useCallback(() => {
      const driver = getDriver();
      const sub = driver.watchNearbyStations((s) => {
        useNearbyStore.getState().record(s);
      });
      scanSubRef.current = sub;
      return () => {
        sub.stop();
        scanSubRef.current = null;
        setPresenceLatched(false);
      };
    }, []),
  );

  // Live BLE presence for the header chip — advert-based (fed by the passive
  // scan above), so the header reflects real reachability instead of a static
  // "24/7 açık" label that meant nothing to the user.
  // Match the map marker's freshness window (nearbyStore STALE_MS, now 10s)
  // EXACTLY, so a station that's offline on the map is never simultaneously
  // "açık" here. A mismatch (this screen at 25s vs the map at 10s) let the user
  // open a powered-off station and still pick a sport for ~15s after the map
  // had already greyed it out.
  const proximity = useFreshPresence(station?.id ?? '', { maxAgeMs: 10_000 });
  // Demo Mode (App Store review): there's no hardware advertising, so treat the
  // station as in-range/open — otherwise OYNA never lights up and a reviewer
  // can't run the unlock. The mock driver simulates the rest.
  const demoMode = useDevStore((s) => s.demoMode);
  const open = demoMode || proximity.present || presenceLatched;

  // Latch presence the first time we hear the station, then stop the nearby-scan
  // so the unlock/read connect owns the radio (see the focus effect above).
  // Once latched the header stays "açık" without a live scan; the tap's own
  // connect is the real reachability check from here on. Un-latches on refocus.
  useEffect(() => {
    if ((proximity.present || demoMode) && !presenceLatched) {
      setPresenceLatched(true);
      scanSubRef.current?.stop();
      scanSubRef.current = null;
    }
  }, [proximity.present, demoMode, presenceLatched]);

  // Settle window: BLE takes ~1s to resolve on first open. Until then we show a
  // neutral "bağlanıyor…" rather than flashing "kapalı" at someone standing in
  // front of a powered station. Once we've either heard it (open) or the window
  // lapses, we commit to açık / kapalı.
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setSettled(true), 1500);
    return () => clearTimeout(id);
  }, []);
  const closed = settled && !open;
  const settling = !open && !settled;

  // Two honest states (+ the brief settle): the ESP32 is Bluetooth-only, so
  // "out of range" and "powered off" are the same thing to the phone — both are
  // simply "not heard", i.e. kapalı. No "kontrol ediliyor" limbo.
  // No "kapalı" word in the corner — it read as harsh there, and the body
  // banner already says it. Closed → just the muted dot; only surface a word
  // for the positive ("açık") and transient ("bağlanıyor…") states.
  const statusLabel = open ? 'açık' : settling ? 'bağlanıyor…' : '';
  const statusDot = open
    ? palette.volt
    : closed
    ? palette.ink + '55'
    : palette.ink + '33';

  if (!station) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: palette.paper,
          alignItems: 'center',
          justifyContent: 'center',
          paddingHorizontal: 24,
          paddingTop: insets.top,
        }}
      >
        <Pressable
          onPress={() => router.back()}
          hitSlop={12}
          style={{ position: 'absolute', top: insets.top + 16, left: 16 }}
        >
          <Feather name="x" size={24} color={palette.ink} />
        </Pressable>
        <Text
          style={{
            fontFamily: 'Unbounded_800ExtraBold',
            color: palette.ink,
            fontSize: 28,
            lineHeight: 33,
            textAlign: 'center',
          }}
        >
          {t('station.not_found')}
        </Text>
        <Text
          style={{
            color: palette.ink + '99',
            textAlign: 'center',
            marginTop: 12,
            fontSize: 15,
          }}
        >
          {t('station.not_found_sub')}
        </Text>
      </View>
    );
  }

  const onBack = async () => {
    await hx.tap();
    router.back();
  };

  const [dirOpen, setDirOpen] = useState(false);
  const onDirections = async () => {
    await hx.tap();
    // Open the on-brand chooser (Apple / Google / Yandex). See DirectionsSheet.
    setDirOpen(true);
  };

  const onUnlock = useGuardedPress(async (sport: Sport, durationMinutes: number, gateId?: string) => {
    // Route to the "how it works" prep slides; the last slide starts the session.
    // Duration travels through the prep flow as a route param so the slider value
    // the user picked here actually drives the session timer (and the firmware's
    // overdue clock) instead of session-prep silently defaulting to 30.
    //
    // gateId is the RESERVED gate's slug (the first free gate within the sport's
    // stock). It must reach the unlock screen verbatim so sign-unlock can link
    // the unlock to a reservation by exact slug match. Omitted when undefined so
    // the unlock path can safely skip linkage rather than guess a wrong slug.
    router.push({
      pathname: '/session-prep/[stationId]/[sport]',
      params: {
        stationId: station.id,
        sport,
        duration: String(durationMinutes),
        ...(gateId ? { gateId } : {}),
      },
    });
  });

  return (
    <View style={{ flex: 1, backgroundColor: palette.paper }}>
      {/* Top bar — back chevron (dark rounded square) · centered location line ·
          info "i" (dark rounded circle). The mini-title (scroll-driven) stacks
          over the location line and fades in once the big title scrolls away. */}
      <View
        style={{
          paddingTop: insets.top + 12,
          paddingBottom: 10,
          paddingHorizontal: 16,
          flexDirection: 'row',
          alignItems: 'center',
          // Opaque + above the scroll content so the big title fades away
          // *behind* the bar instead of bleeding through it (was transparent,
          // which let "PLAYBOX DEV WORKSHOP" overlap the city line + demo badge).
          backgroundColor: palette.paper,
          zIndex: 10,
        }}
      >
        <Pressable
          onPress={onBack}
          hitSlop={14}
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
          style={{
            width: 40,
            height: 40,
            borderRadius: 12,
            backgroundColor: palette.surface,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Feather name="chevron-left" size={24} color={palette.fg} />
        </Pressable>

        {/* Centered location line + scroll-driven mini title stacked on top. */}
        <View style={{ flex: 1, marginHorizontal: 12, alignItems: 'center', justifyContent: 'center' }}>
          <Animated.Text
            numberOfLines={1}
            style={[
              {
                fontFamily: 'JetBrainsMono_500Medium',
                fontSize: 13,
                color: palette.fg,
                letterSpacing: 0.3,
                textAlign: 'center',
              },
              locationStyle,
            ]}
          >
            {CITY_LABELS[station.city]}
          </Animated.Text>
          {/* Mini title — appears once the big title has scrolled away.
              Fades + slides in via miniTitleStyle. */}
          <Animated.Text
            numberOfLines={1}
            style={[
              {
                position: 'absolute',
                fontFamily: 'Unbounded_800ExtraBold',
                fontSize: 15,
                color: palette.fg,
                letterSpacing: 0.2,
                textAlign: 'center',
              },
              miniTitleStyle,
            ]}
          >
            {station.name.toUpperCase()}
          </Animated.Text>
        </View>

        <Pressable
          onPress={onDirections}
          hitSlop={14}
          accessibilityRole="button"
          accessibilityLabel={t('station.directions')}
          style={{
            width: 40,
            height: 40,
            borderRadius: 20,
            backgroundColor: palette.surface,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Feather name="navigation" size={19} color={palette.fg} />
        </Pressable>
      </View>

      <Animated.ScrollView
        onScroll={scrollHandler}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: 24,
          paddingTop: 24,
          paddingBottom: insets.bottom + 120,
        }}
      >
        {/* Title block — big Anton headline (uppercase) + live status dot. */}
        <Animated.Text
          style={[
            {
              fontFamily: 'Unbounded_800ExtraBold',
              color: palette.fg,
              fontSize: 29,
              lineHeight: 34,
              letterSpacing: 0.2,
              textTransform: 'uppercase',
            },
            bigTitleStyle,
          ]}
          numberOfLines={2}
          adjustsFontSizeToFit
          minimumFontScale={0.75}
        >
          {station.name}
        </Animated.Text>
        {/* No small status dot here — the big "kapalı"/"bağlanıyor…" text in the
            selector below carries the status. */}

        <View style={{ marginTop: 36 }}>
          {/* Always render the selector so the balls (sports) stay visible even
              when closed — it dims + disables them and shows a calm "kapalı"
              banner in place of the slider/CTA. `open`/`settling` come from the
              header's presence so dot and body never disagree. */}
          <StationGateSelector
            station={station}
            onUnlock={onUnlock}
            unlocking={unlocking}
            open={open}
            settling={settling}
          />
        </View>

        {/* Bench servo controls — DEV BUILDS or the DEVELOPER account (see
            useIsDeveloper / DEVELOPER_PHONES). App Store reviewers (Demo Mode /
            REVIEW_PHONE) and real prod users match neither, so they still get
            the clean flow (locker → OYNA → unlock → session → return). The
            developer sees them in release for on-site hardware bring-up. */}
        {(__DEV__ || isDeveloper) ? <DevServoButtons stationId={station.id} /> : null}

      </Animated.ScrollView>

      {/* Support — pinned to the bottom-right corner as a subtle floating link
          so a user stuck at a station can always reach help without it crowding
          the OYNA cluster. Positioning lives on the STATIC Pressable style
          (function-form styles are dropped on this RN build); the pressed
          opacity uses the function-child instead. */}
      <Pressable
        onPress={async () => {
          await hx.tap();
          router.push('/support');
        }}
        accessibilityRole="button"
        accessibilityLabel="sorun mu var? destek al"
        hitSlop={10}
        style={{ position: 'absolute', right: 16, bottom: insets.bottom + 12 }}
      >
        {({ pressed }) => (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              paddingVertical: 9,
              paddingHorizontal: 14,
              borderRadius: 999,
              backgroundColor: palette.surface + 'e6',
              borderWidth: 1,
              borderColor: palette.ink + '1f',
              opacity: pressed ? 0.55 : 1,
            }}
          >
            <Feather name="help-circle" size={14} color={palette.ink + '99'} />
            <Text
              style={{
                fontFamily: 'Inter_600SemiBold',
                color: palette.ink + 'b3',
                fontSize: 12.5,
                letterSpacing: 0.2,
              }}
            >
              destek
            </Text>
          </View>
        )}
      </Pressable>

      <DirectionsSheet
        dest={station ? { name: station.name, lat: station.lat, lng: station.lng } : null}
        visible={dirOpen}
        onClose={() => setDirOpen(false)}
      />
    </View>
  );
}

// =============================================================================
// DevServoButtons — Phase 0 only.
// Drives the breadboard solenoid relay directly without going through the
// reservation / payment-hold flow. The edge function only honors
// `dev_bypass` for station_id === 'DEV-001', so this is scoped to the dev unit.
//
// Reads the firmware's INFO characteristic to know the live state of each
// gate. UNLOCK is only enabled when the firmware reports LOCKED; RETURN is
// only enabled when the firmware reports IN_USE AND it has a stored
// session id we can replay. This eliminates two classes of testing pain:
//   1. Tapping UNLOCK while firmware was already IN_USE (silent drop)
//   2. Sending RETURN with a session id the firmware doesn't recognize
//      (silent drop due to session mismatch)
// =============================================================================
const GATES_MAX: Array<1 | 2 | 3> = [1, 2, 3];

type FwGateState = 'LOCKED' | 'UNLOCKED' | 'IN_USE' | 'RETURN_UNLOCKED';

type FwSnapshot = {
  /** Per-gate state, keyed by 1-indexed gate number. */
  states: Record<
    number,
    // `door` is the physical reed state ("closed" = magnet near = shut). Optional
    // so old firmware (no reed reporting) still parses.
    { state: FwGateState; session_id: string; door?: 'open' | 'closed' }
  >;
  /** Number of compartments the firmware exposes (1 for old fw, 3 for new). */
  gates: number;
  /** Firmware version string from the INFO characteristic. */
  fw?: string;
};

function DevServoButtons({ stationId }: { stationId: string }) {
  const [busy, setBusy] = useState<null | 'unlock' | 'return' | 'refresh' | 'close'>(null);
  const [lastResult, setLastResult] = useState<string>('');
  const [gate, setGate] = useState<1 | 2 | 3>(1);
  const [fw, setFw] = useState<FwSnapshot | null>(null);

  // Read INFO and parse the firmware's per-gate state into a useful shape.
  // Quietly no-ops if BLE isn't connected yet (the connection happens on
  // first action) so we don't show errors on initial mount.
  const refreshFirmwareState = async (opts: { connect?: boolean } = {}): Promise<FwSnapshot | null> => {
    try {
      if (!stationClient.isConnected()) {
        if (!opts.connect) return null;
        await stationClient.scanAndConnect(`Playbox-${stationId.toUpperCase()}`, 8000);
      }
      const info = (await stationClient.readInfo()) as Record<string, unknown>;
      const states: FwSnapshot['states'] = {};
      const rawStates = (info?.states as unknown[]) ?? [];
      for (const s of rawStates) {
        const obj = s as {
          gate?: number;
          state?: string;
          session_id?: string;
          door?: string;
        };
        if (typeof obj.gate === 'number') {
          states[obj.gate] = {
            state: (obj.state ?? 'LOCKED') as FwGateState,
            session_id: obj.session_id ?? '',
            door:
              obj.door === 'closed'
                ? 'closed'
                : obj.door === 'open'
                ? 'open'
                : undefined,
          };
        }
      }
      const snap: FwSnapshot = {
        states,
        gates: typeof info?.gates === 'number' ? info.gates : Object.keys(states).length || 1,
        fw: typeof info?.fw === 'string' ? info.fw : undefined,
      };
      setFw(snap);
      return snap;
    } catch (e) {
      const msg = String((e as Error)?.message ?? e);
      console.log('[DEV] INFO read failed:', msg);
      // When this was an explicit user-initiated connect (fw durumu oku or an
      // action passing connect:true), surface the REAL reason on-screen so a
      // failure is diagnosable with no serial/LED — "Timeout: …not found",
      // "operation was cancelled", "bluetooth off" each point at a different
      // fix. Stays silent on mount (no connect) so we don't flash errors idle.
      if (opts.connect) setLastResult(`✗ ${msg}`);
      return null;
    }
  };

  // Initial fetch on mount. Doesn't force a connect — if the proximity
  // watcher already brought a connection up, we read instantly; otherwise
  // we wait for the first user action.
  useEffect(() => {
    refreshFirmwareState();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stationId]);

  // If the selected gate is greater than what the firmware exposes, snap
  // it back to gate 1. Old single-gate fw reports `gates: 1` so picking
  // gate 2/3 would just send commands the firmware reinterprets as gate 1.
  useEffect(() => {
    if (fw && gate > fw.gates) setGate(1);
  }, [fw, gate]);

  const fwForGate = fw?.states[gate];
  const fwState: FwGateState | undefined = fwForGate?.state;
  const fwSessionId: string | undefined = fwForGate?.session_id || undefined;

  const canUnlock = !busy && (fwState === undefined || fwState === 'LOCKED');
  const canReturn = !busy && fwState === 'IN_USE' && !!fwSessionId;
  // Sim-close = app stand-in for the reed / EN(BOOT) door-closed edge, so the
  // full rent→close→return→close cycle runs on-phone with no physical button.
  // Advances UNLOCKED→IN_USE or RETURN_UNLOCKED→LOCKED; firmware honors it only
  // when built DEV_SIM_CLOSE (the dev unit). Reed switches will replace this.
  const canClose = !busy && (fwState === 'UNLOCKED' || fwState === 'RETURN_UNLOCKED');

  const runClose = async () => {
    if (busy) return;
    setBusy('close');
    setLastResult(`gate ${gate} → sim kapanış (reed/EN yerine)...`);
    try {
      if (!stationClient.isConnected()) {
        await stationClient.scanAndConnect(`Playbox-${stationId.toUpperCase()}`, 8000);
      }
      await stationClient.simulateClose(gate);
      const snap = await refreshFirmwareState();
      const newState = snap?.states[gate]?.state;
      setLastResult(`✓ gate ${gate} sim kapandı — state: ${newState ?? '?'}`);
    } catch (e: unknown) {
      const msg = String((e as Error)?.message ?? e);
      setLastResult(`✗ ${msg}`);
      Alert.alert('Sim close failed', msg);
    } finally {
      setBusy(null);
    }
  };

  const runUnlock = async () => {
    console.log('[DEV] UNLOCK tap gate=', gate, 'fwState=', fwState);
    if (busy) return;
    setBusy('unlock');
    setLastResult(`gate ${gate} → signing payload...`);
    const sessionId = `dev-${Date.now()}`;
    try {
      const signed = await fetchSignedUnlock({
        stationId,
        gate,
        sessionId,
        durationMin: 30,
        devBypass: true,
      });
      setLastResult(`gate ${gate} → payload signed, connecting BLE...`);
      if (!stationClient.isConnected()) {
        await stationClient.scanAndConnect(`Playbox-${stationId.toUpperCase()}`, 8000);
      }
      setLastResult(`gate ${gate} → writing BLE...`);
      await stationClient.unlock(signed);
      // Re-read firmware state. If state didn't change from LOCKED, the
      // command was silently dropped (state mismatch or auth issue) — surface that.
      const snap = await refreshFirmwareState();
      const newState = snap?.states[gate]?.state;
      if (newState === 'UNLOCKED') {
        setLastResult(`✓ gate ${gate} unlocked — state: UNLOCKED`);
      } else {
        setLastResult(`⚠ gate ${gate} write sent but state is ${newState ?? 'unknown'} — check serial`);
      }
    } catch (e: unknown) {
      const msg = String((e as Error)?.message ?? e);
      console.error('[DEV] UNLOCK failed:', msg);
      setLastResult(`✗ ${msg}`);
      Alert.alert('Force Unlock failed', msg);
    } finally {
      setBusy(null);
    }
  };

  const runReturn = async () => {
    console.log('[DEV] RETURN tap gate=', gate, 'fwState=', fwState, 'fwSession=', fwSessionId);
    if (busy) return;
    // Use the firmware's stored session_id, not anything we generated. This
    // is the whole fix for the "RETURN ignored due to session mismatch" bug.
    if (!fwSessionId) {
      Alert.alert(
        'firmware has no active session',
        `gate ${gate} is in state ${fwState ?? '?'}. tap UNLOCK first to put it in IN_USE, then RETURN.`,
      );
      return;
    }
    setBusy('return');
    setLastResult(`gate ${gate} → signing return for fw session ${fwSessionId.slice(0, 16)}...`);
    try {
      const signed = await fetchSignedReturnUnlock({
        stationId,
        gate,
        sessionId: fwSessionId,
        devBypass: true,
      });
      setLastResult(`gate ${gate} → payload signed, connecting BLE...`);
      if (!stationClient.isConnected()) {
        await stationClient.scanAndConnect(`Playbox-${stationId.toUpperCase()}`, 8000);
      }
      setLastResult(`gate ${gate} → writing BLE...`);
      await stationClient.returnUnlock(signed);
      const snap = await refreshFirmwareState();
      const newState = snap?.states[gate]?.state;
      if (newState === 'RETURN_UNLOCKED') {
        setLastResult(`✓ gate ${gate} return sent — state: RETURN_UNLOCKED. press BOOT to close.`);
      } else {
        setLastResult(`⚠ gate ${gate} write sent but state is ${newState ?? 'unknown'} — check serial`);
      }
    } catch (e: unknown) {
      const msg = String((e as Error)?.message ?? e);
      console.error('[DEV] RETURN failed:', msg);
      setLastResult(`✗ ${msg}`);
      Alert.alert('Force Return failed', msg);
    } finally {
      setBusy(null);
    }
  };

  const runRefresh = async () => {
    if (busy) return;
    setBusy('refresh');
    setLastResult('reading firmware state...');
    const snap = await refreshFirmwareState({ connect: true });
    if (snap) {
      // Surface the last drop reason too — if the link dropped mid-use and we
      // just reconnected, this tells us WHY (520=RF/supervision timeout,
      // 19/531=peripheral terminated, 8=conn timeout) with no serial/LED.
      const drop = stationClient.lastDisconnectReason();
      setLastResult(
        `fw ${snap.fw ?? '?'} · gates=${snap.gates}${drop ? ` · son kopma: ${drop}` : ''}`,
      );
    } else {
      setLastResult('✗ INFO read failed (not connected?)');
    }
    setBusy(null);
  };

  // Visible gate buttons: limited by what firmware reports. Old fw=1, new fw=3.
  const visibleGates = (fw ? GATES_MAX.slice(0, Math.min(fw.gates, GATES_MAX.length)) : GATES_MAX) as Array<1 | 2 | 3>;

  return (
    <View style={{ marginTop: 36 }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          marginBottom: 14,
        }}
      >
        <View
          style={{
            flex: 1,
            height: 1,
            backgroundColor: palette.surface + '22',
          }}
        />
        <Text
          style={{
            fontFamily: 'JetBrainsMono_700Bold',
            fontSize: 10,
            letterSpacing: 2,
            color: palette.ink + 'aa',
            paddingHorizontal: 10,
          }}
        >
          DEV · {stationId}
        </Text>
        <View
          style={{
            flex: 1,
            height: 1,
            backgroundColor: palette.surface + '22',
          }}
        />
      </View>

      {/* Firmware state row — what the ESP32 says about each gate right now.
          Each cell is a BIG tappable box: large gate number, legible state
          label, and session id snippet. Tapping selects the gate. */}
      <View
        style={{
          flexDirection: 'row',
          gap: 12,
          marginBottom: 16,
          justifyContent: 'center',
        }}
      >
        {visibleGates.map((g) => {
          const selected = g === gate;
          const s = fw?.states[g]?.state;
          const sess = fw?.states[g]?.session_id;
          const door = fw?.states[g]?.door;
          // High-contrast state pill (dark theme: `ink` is the LIGHT text, so
          // fills must be solid and text picked to contrast each fill).
          const open = s === 'UNLOCKED' || s === 'RETURN_UNLOCKED';
          const inUse = s === 'IN_USE';
          const pillFill = open
            ? palette.volt
            : inUse
            ? palette.butter
            : palette.border;
          const pillText = open ? palette.voltInk : inUse ? '#FFFFFF' : palette.ink;
          return (
            <Pressable
              key={g}
              onPress={() => setGate(g)}
              disabled={!!busy}
              style={({ pressed }) => ({
                flex: 1,
                paddingVertical: 14,
                paddingHorizontal: 6,
                borderRadius: 18,
                borderWidth: 2,
                borderColor: selected ? palette.volt : palette.border,
                backgroundColor: palette.surface,
                alignItems: 'center',
                opacity: pressed && !busy ? 0.7 : 1,
              })}
            >
              <Text
                style={{
                  fontFamily: 'Unbounded_800ExtraBold',
                  fontSize: 26,
                  lineHeight: 31,
                  color: selected ? palette.volt : palette.ink,
                }}
              >
                {g}
              </Text>
              <View
                style={{
                  marginTop: 8,
                  paddingHorizontal: 8,
                  paddingVertical: 4,
                  borderRadius: 8,
                  backgroundColor: pillFill,
                  maxWidth: '100%',
                }}
              >
                <Text
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  style={{
                    fontFamily: 'JetBrainsMono_700Bold',
                    fontSize: 11,
                    letterSpacing: 0.3,
                    color: pillText,
                  }}
                >
                  {s ?? '—'}
                </Text>
              </View>
              {/* Physical door (reed) state — ground truth from the magnet.
                  Green = shut, orange = open, dash = old fw / unknown. */}
              <Text
                numberOfLines={1}
                style={{
                  fontFamily: 'JetBrainsMono_700Bold',
                  fontSize: 11,
                  letterSpacing: 0.2,
                  marginTop: 7,
                  color:
                    door === 'closed'
                      ? palette.volt
                      : door === 'open'
                      ? palette.butter
                      : palette.muted,
                }}
              >
                {door === 'closed' ? '🚪 KAPALI' : door === 'open' ? '🚪 AÇIK' : '🚪 —'}
              </Text>
              <Text
                numberOfLines={1}
                style={{
                  fontFamily: 'JetBrainsMono_400Regular',
                  fontSize: 11,
                  color: palette.muted,
                  marginTop: 6,
                  maxWidth: '100%',
                }}
              >
                {sess ? sess.slice(-8) : '—'}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* Action row — UNLOCK / RETURN gated by firmware state. Disabled means
          firmware would silently drop the command, so we don't even send it. */}
      <View style={{ flexDirection: 'row', gap: 14, marginBottom: 16 }}>
        <Pressable
          onPress={runUnlock}
          disabled={!canUnlock}
          style={({ pressed }) => ({
            flex: 1,
            opacity: !canUnlock ? 0.4 : pressed ? 0.85 : 1,
            transform: [{ scale: pressed && canUnlock ? 0.96 : 1 }],
          })}
        >
          <View
            style={{
              paddingVertical: 20,
              paddingHorizontal: 12,
              borderRadius: 18,
              backgroundColor: palette.volt,
              alignItems: 'center',
              justifyContent: 'center',
              flexDirection: 'row',
              shadowColor: palette.volt,
              shadowOffset: { width: 0, height: 8 },
              shadowOpacity: canUnlock ? 0.35 : 0,
              shadowRadius: 14,
              elevation: canUnlock ? 8 : 0,
            }}
          >
            <Feather
              name="unlock"
              size={20}
              color={palette.voltInk}
              style={{ marginRight: 9 }}
            />
            <Text
              style={{
                color: palette.voltInk,
                fontFamily: 'Unbounded_800ExtraBold',
                fontSize: 16,
                letterSpacing: 0.5,
              }}
            >
              {busy === 'unlock' ? '...' : 'AÇ'}
            </Text>
          </View>
        </Pressable>

        <Pressable
          onPress={runReturn}
          disabled={!canReturn}
          style={({ pressed }) => ({
            flex: 1,
            opacity: !canReturn ? 0.4 : pressed ? 0.85 : 1,
            transform: [{ scale: pressed && canReturn ? 0.96 : 1 }],
          })}
        >
          <View
            style={{
              paddingVertical: 20,
              paddingHorizontal: 12,
              borderRadius: 18,
              backgroundColor: palette.butter,
              alignItems: 'center',
              justifyContent: 'center',
              flexDirection: 'row',
              shadowColor: palette.butter,
              shadowOffset: { width: 0, height: 8 },
              shadowOpacity: canReturn ? 0.4 : 0,
              shadowRadius: 14,
              elevation: canReturn ? 8 : 0,
            }}
          >
            <Feather
              name="rotate-ccw"
              size={20}
              color="#FFFFFF"
              style={{ marginRight: 9 }}
            />
            <Text
              style={{
                color: '#FFFFFF',
                fontFamily: 'Unbounded_800ExtraBold',
                fontSize: 16,
                letterSpacing: 0.5,
              }}
            >
              {busy === 'return' ? '...' : 'İADE'}
            </Text>
          </View>
        </Pressable>
      </View>

      {/* Sim close — drives the reed / door-closed edge from the phone so you
          don't have to press the ESP32 EN/BOOT button. Enabled after UNLOCK
          (→IN_USE) and after RETURN (→LOCKED). */}
      <Pressable
        onPress={runClose}
        disabled={!canClose}
        style={({ pressed }) => ({
          marginBottom: 16,
          opacity: !canClose ? 0.4 : pressed ? 0.85 : 1,
        })}
      >
        <View
          style={{
            paddingVertical: 18,
            borderRadius: 20,
            borderWidth: 2,
            borderColor: palette.border,
            backgroundColor: 'transparent',
            alignItems: 'center',
            justifyContent: 'center',
            flexDirection: 'row',
          }}
        >
          <Feather
            name="check-square"
            size={20}
            color={palette.ink}
            style={{ marginRight: 10 }}
          />
          <Text
            style={{
              color: palette.ink,
              fontFamily: 'Unbounded_800ExtraBold',
              fontSize: 16,
              letterSpacing: 0.5,
            }}
          >
            {busy === 'close' ? '...' : 'KAPAT (sim)'}
          </Text>
        </View>
      </Pressable>

      {/* Manual refresh — re-reads INFO from the firmware in case state
          drifted (e.g. someone pressed BOOT outside the action flow).
          Full-width BIG button so it's obvious and never crowds the row. */}
      <Pressable
        onPress={runRefresh}
        disabled={!!busy}
        hitSlop={8}
        style={({ pressed }) => ({
          marginBottom: 16,
          opacity: pressed && !busy ? 0.7 : busy ? 0.4 : 1,
        })}
      >
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            paddingVertical: 15,
            paddingHorizontal: 16,
            borderRadius: 18,
            borderWidth: 2,
            borderColor: palette.border,
            backgroundColor: palette.surface,
          }}
        >
          <Feather
            name="refresh-cw"
            size={17}
            color={palette.ink}
            style={{ marginRight: 9 }}
          />
          <Text
            style={{
              fontFamily: 'JetBrainsMono_700Bold',
              fontSize: 13,
              letterSpacing: 1,
              color: palette.ink,
              textTransform: 'uppercase',
            }}
          >
            {busy === 'refresh' ? 'okuyor...' : 'fw durumu oku'}
          </Text>
        </View>
      </Pressable>

      {lastResult ? (
        <Text
          style={{
            fontFamily: 'JetBrainsMono_400Regular',
            fontSize: 11.5,
            color: palette.ink,
            marginTop: 10,
            textAlign: 'center',
            lineHeight: 16,
          }}
        >
          {lastResult}
        </Text>
      ) : (
        <Text
          style={{
            fontFamily: 'Inter_400Regular',
            fontSize: 11,
            color: palette.muted,
            marginTop: 10,
            textAlign: 'center',
            lineHeight: 15,
          }}
        >
          gate seç · AÇ = röle 300ms · İADE = aynı seansı sürdürür
        </Text>
      )}
    </View>
  );
}
