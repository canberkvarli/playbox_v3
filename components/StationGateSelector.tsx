import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  LayoutChangeEvent,
  PanResponder,
  Pressable,
  Text,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import Animated, {
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { useRouter } from 'expo-router';

import { useT } from '@/hooks/useT';
import { hx } from '@/lib/haptics';
import { palette } from '@/constants/theme';
import { Button } from '@/components/ui';
import { costForMinutes, formatTry, RATE_PER_MIN_GROSS } from '@/lib/pricing';
import { SPORT_EMOJI } from '@/data/sports';
import { gatesForStation, SPORT_LABELS, STATIONS, type Gate, type Station, type Sport } from '@/data/stations.seed';
import { useStationInRange } from '@/lib/ble/useStationInRange';
import { RESERVATION_LOCK_MIN, useReservationState } from '@/lib/reservations';
import { useSessionStore } from '@/stores/sessionStore';
import { supabase } from '@/lib/supabase';
import { useGuardedPress } from '@/hooks/useGuardedPress';

const DURATION_MIN = 10;
const DURATION_MAX = 180;
const DURATION_STEP = 5;
const DURATION_DEFAULT = 30;

function formatDuration(minutes: number) {
  if (minutes < 60) return { big: String(minutes), unit: 'dakika' };
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (m === 0) return { big: `${h} sa`, unit: 'saat' };
  return { big: `${h} sa ${m}`, unit: 'dakika' };
}

function DurationSlider({
  value,
  onChange,
  accent,
  trackColor,
  thumbLabelColor,
}: {
  value: number;
  onChange: (v: number) => void;
  accent: string;
  trackColor: string;
  thumbLabelColor: string;
}) {
  const [width, setWidth] = useState(0);
  const widthRef = useRef(0);
  const draggingRef = useRef(false);

  const onLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    widthRef.current = w;
    setWidth(w);
  };

  const valueFromX = (x: number) => {
    const w = widthRef.current;
    if (w <= 0) return value;
    const clamped = Math.max(0, Math.min(w, x));
    const ratio = clamped / w;
    const raw = DURATION_MIN + ratio * (DURATION_MAX - DURATION_MIN);
    const stepped = Math.round(raw / DURATION_STEP) * DURATION_STEP;
    return Math.max(DURATION_MIN, Math.min(DURATION_MAX, stepped));
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponderCapture: () => true,
      // Refuse to hand the gesture back to ancestors (e.g. ScrollView) mid-drag.
      // Without this, a tiny vertical drift of the finger lets the ScrollView
      // claim the gesture and the slider snaps back.
      onPanResponderTerminationRequest: () => false,
      onShouldBlockNativeResponder: () => true,
      onPanResponderGrant: (e) => {
        draggingRef.current = true;
        onChange(valueFromX(e.nativeEvent.locationX));
      },
      onPanResponderMove: (e) => {
        onChange(valueFromX(e.nativeEvent.locationX));
      },
      onPanResponderRelease: () => {
        draggingRef.current = false;
      },
      onPanResponderTerminate: () => {
        draggingRef.current = false;
      },
    })
  ).current;

  const ratio = (value - DURATION_MIN) / (DURATION_MAX - DURATION_MIN);
  const fillWidth = width * ratio;
  const thumbX = Math.max(0, Math.min(width, fillWidth));

  return (
    <View
      onLayout={onLayout}
      {...panResponder.panHandlers}
      style={{
        height: 44,
        justifyContent: 'center',
        width: '100%',
      }}
    >
      {/* Track */}
      <View
        style={{
          height: 6,
          borderRadius: 3,
          backgroundColor: trackColor,
          overflow: 'hidden',
        }}
      >
        <View
          style={{
            height: 6,
            width: fillWidth,
            backgroundColor: accent,
          }}
        />
      </View>
      {/* Thumb */}
      {width > 0 ? (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: thumbX - 14,
            width: 28,
            height: 28,
            borderRadius: 14,
            backgroundColor: accent,
            shadowColor: accent,
            shadowOffset: { width: 0, height: 4 },
            shadowOpacity: 0.35,
            shadowRadius: 8,
            elevation: 4,
            borderWidth: 3,
            borderColor: thumbLabelColor,
          }}
        />
      ) : null}
    </View>
  );
}

function GateCard({
  sport,
  index,
  selected,
  disabled,
  onPress,
}: {
  sport: Sport;
  index: number;
  selected: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  const press = useSharedValue(0);
  const sel = useSharedValue(selected ? 1 : 0);

  useEffect(() => {
    sel.value = withSpring(selected ? 1 : 0, { damping: 14, stiffness: 220 });
  }, [selected, sel]);

  const rowStyle = useAnimatedStyle(() => ({
    // Gentle grow on press/select — subtle; the selection is carried by the
    // volt border + the "seç" volt label on the right.
    transform: [{ scale: 1 + sel.value * 0.01 - press.value * 0.02 }],
    borderColor: disabled
      ? palette.danger + '88'
      : selected
      ? palette.volt
      : palette.border,
    borderWidth: selected ? 2 : 1,
    backgroundColor: disabled ? palette.danger + '14' : palette.surface,
  }));

  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      onPressIn={() => (press.value = withTiming(1, { duration: 80 }))}
      onPressOut={() => (press.value = withTiming(0, { duration: 120 }))}
      style={{ opacity: disabled ? 0.7 : 1 }}
    >
      <Animated.View
        style={[
          {
            borderRadius: 16,
            padding: 14,
            flexDirection: 'row',
            alignItems: 'center',
            overflow: 'hidden',
          },
          rowStyle,
        ]}
      >
        {/* Emoji tile */}
        <View
          style={{
            width: 48,
            height: 48,
            borderRadius: 12,
            backgroundColor: palette.surfaceAlt,
            alignItems: 'center',
            justifyContent: 'center',
            marginRight: 14,
          }}
        >
          <Text style={{ fontSize: 24 }}>{SPORT_EMOJI[sport]}</Text>
        </View>
        {/* Sport name */}
        <Text
          numberOfLines={1}
          style={{
            flex: 1,
            fontFamily: 'Inter_600SemiBold',
            fontSize: 16,
            color: palette.fg,
            letterSpacing: 0.2,
          }}
        >
          {SPORT_LABELS[sport]}
        </Text>
        {/* Right-side affordance — "DOLU" when in use, else the "seç" volt label. */}
        {disabled ? (
          <View
            style={{
              backgroundColor: palette.danger,
              borderRadius: 8,
              paddingHorizontal: 8,
              paddingVertical: 3,
            }}
          >
            <Text
              style={{
                fontFamily: 'Inter_600SemiBold',
                color: palette.fg,
                fontSize: 11,
                letterSpacing: 0.4,
              }}
            >
              DOLU
            </Text>
          </View>
        ) : (
          <Text
            style={{
              fontFamily: 'Inter_600SemiBold',
              fontSize: 14,
              color: palette.volt,
              letterSpacing: 0.2,
            }}
          >
            seç
          </Text>
        )}
      </Animated.View>
    </Pressable>
  );
}


export type StationGateSelectorProps = {
  station: Station;
  // `gateId` is the RESERVED gate's slug (`selectedGate.id`, the first free
  // gate within the sport's stock). It must be replayed verbatim at unlock
  // time so sign-unlock can link the unlock to a reservation holding the same
  // slug. May be undefined if availability hasn't resolved a gate yet.
  onUnlock: (
    sport: Sport,
    durationMinutes: number,
    gateId?: string,
  ) => void | Promise<void>;
  unlocking?: boolean;
  /**
   * Whether the station is currently reachable over BLE (driven by the parent's
   * presence so the header dot and this body never disagree). When false the
   * balls stay visible but go non-interactive + dimmed, and the action area
   * shows a calm "kapalı" instead of the slider/CTA. `settling` is the brief
   * first-mount window before BLE resolves — show "bağlanıyor…", not "kapalı".
   */
  open?: boolean;
  settling?: boolean;
};

export function StationGateSelector({
  station,
  onUnlock,
  unlocking,
  open = true,
  settling = false,
}: StationGateSelectorProps) {
  const { t } = useT();
  const router = useRouter();
  const {
    inRange,
    state: proximityState,
    unreachable,
    retry: retryProximity,
  } = useStationInRange(station.id);
  // Until we either connect (in_range) or give up (unreachable), present ONE
  // stable "kontrol ediliyor" state. scanning and the transient out_of_range
  // blips in between are the same thing to the user, so the CTA never toggles
  // between "checking" and "out of range" while the radio hunts. After
  // UNREACHABLE_MS the hook flips `unreachable` and stops scanning entirely.
  const proximityChecking = !inRange && !unreachable;

  // Server-state hook — drives the disabled state if user has an active
  // reservation elsewhere. Polling is off here (not a long-lived screen);
  // the /reserve flow re-fetches on its own when the user navigates.
  const { state: reservationState } = useReservationState({ pollMs: 0, sweepBeforeFetch: false });
  const activeReservation = reservationState?.active ?? null;

  // One active session per account. If the user already has a session open,
  // we either send them to /play (same station) or hard-block them (different
  // station) — no silent "overwrite" of the current session.
  const activeSession = useSessionStore((s) => s.active);
  const sessionAtThisStation = !!activeSession && activeSession.stationId === station.id;
  const sessionAtOtherStation = !!activeSession && activeSession.stationId !== station.id;

  const [selected, setSelected] = useState<Sport | null>(null);
  const [duration, setDuration] = useState(DURATION_DEFAULT);
  const [reserving, setReserving] = useState(false);

  // Gate picker — only meaningful once a sport is chosen.
  const [selectedGate, setSelectedGate] = useState<Gate | null>(null);
  const [takenGateIds, setTakenGateIds] = useState<string[]>([]);
  const allGates = useMemo(
    () => (selected ? gatesForStation(station, selected) : []),
    [station, selected],
  );
  const availableGates = useMemo(
    () => allGates.filter((g) => !takenGateIds.includes(g.id)),
    [allGates, takenGateIds],
  );

  // When the user picks a different sport, reload taken-gate availability
  // and auto-select the first free gate. The taken_gates RPC is
  // security-definer and returns only gate_id strings — no leakage.
  useEffect(() => {
    if (!selected) {
      setTakenGateIds([]);
      setSelectedGate(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.rpc('taken_gates', {
        p_station_id: station.id,
        p_sport: selected,
      });
      if (cancelled) return;
      const taken = (data as string[] | null) ?? [];
      setTakenGateIds(taken);
      const free = gatesForStation(station, selected).find(
        (g) => !taken.includes(g.id),
      );
      setSelectedGate(free ?? null);
      if (error && __DEV__) console.warn('[gates] taken_gates rpc error', error);
    })();
    return () => {
      cancelled = true;
    };
  }, [selected, station]);

  const durationDisplay = formatDuration(duration);

  const stockOk = useMemo(() => {
    if (!selected) return false;
    return (station.stock[selected] ?? 0) > 0;
  }, [selected, station]);

  const blockedByOtherReservation =
    !!activeReservation && activeReservation.station_id !== station.id;

  // "Continue" short-circuits all start-flow checks: the button becomes a
  // one-tap jump to /play and stays visually active.
  const canContinueSession = sessionAtThisStation;
  const canStartFresh =
    !!selected &&
    stockOk &&
    !unlocking &&
    !reserving &&
    !blockedByOtherReservation &&
    !sessionAtOtherStation &&
    !sessionAtThisStation &&
    // OYNA only lights up when the station is actually in range — never while
    // we're still checking, and never once we've given up (unreachable).
    inRange;
  const ctaEnabled = canContinueSession || canStartFresh;

  const ctaLabel = unlocking
    ? t('station.unlocking')
    : reserving
    ? t('station.reserving')
    : sessionAtThisStation
    ? t('station.cta_continue_session')
    : sessionAtOtherStation
    ? t('station.cta_session_elsewhere')
    : !selected
    ? t('station.cta_pick_gate')
    : blockedByOtherReservation
    ? t('station.cta_other_reservation')
    : !stockOk
    ? t('station.cta_out_of_stock')
    : unreachable
    ? t('station.no_connection')
    : t('station.cta_unlock');

  const onSelect = async (sp: Sport) => {
    await hx.tap();
    setSelected((prev) => (prev === sp ? null : sp));
  };

  const onPress = useGuardedPress(async () => {
    // Session-active override: if a session is open here, the CTA should just
    // take them to the Play tab. Different station → hard stop (no CTA tap).
    if (sessionAtThisStation) {
      await hx.tap();
      router.replace('/(tabs)/play');
      return;
    }
    if (!ctaEnabled || !selected) return;

    // Out of BLE range: don't silently re-route to reserve. Tell the user
    // what's wrong and let them either move closer or tap Reserve below.
    if (!inRange) {
      await hx.tap();
      Alert.alert(
        t('station.out_of_range_title'),
        t('station.out_of_range_msg'),
      );
      return;
    }

    await hx.press();
    // Forward the selected (first-free) gate's slug so the unlock path can
    // replay it as gate_id for reservation linkage — same string the reserve
    // flow would hold. Falls back to undefined (→ linkage skipped) if no gate
    // resolved, rather than letting the unlock screen reconstruct a wrong slug.
    onUnlock(selected, duration, selectedGate?.id);
  });

  const onReservePress = useGuardedPress(async () => {
    if (!selected || !selectedGate) return;
    await hx.press();
    router.push({
      pathname: '/reserve/[stationId]/[sport]/[gateId]' as const,
      params: {
        stationId: station.id,
        sport: selected,
        gateId: selectedGate.id,
      },
    });
  });

  return (
    <View>
      {/* Gates */}
      <Text
        style={{
          color: palette.muted,
          fontFamily: 'JetBrainsMono_500Medium',
          fontSize: 12,
          letterSpacing: 2,
          textTransform: 'uppercase',
          marginBottom: 12,
        }}
      >
        {t('station.gates_label')}
      </Text>
      {/* Balls stay rendered even when the station is closed — just dimmed and
          non-interactive — so the user always sees what's offered here. */}
      <View
        pointerEvents={open ? 'auto' : 'none'}
        style={{
          gap: 10,
          opacity: open ? 1 : 0.45,
        }}
      >
        {station.sports.map((sport, i) => {
          const out = (station.stock[sport] ?? 0) === 0;
          return (
            <GateCard
              key={sport}
              sport={sport}
              index={i}
              selected={selected === sport}
              disabled={out}
              onPress={() => onSelect(sport)}
            />
          );
        })}
      </View>

      {/* Closed (or still settling): a calm status in the middle, in place of
          the slider + CTA — no Bluetooth-icon block, the balls above carry the
          visual. */}
      {!open ? (
        <View style={{ alignItems: 'center', paddingVertical: 30, gap: 6 }}>
          <Text
            style={{
              fontFamily: 'Unbounded_800ExtraBold',
              fontSize: 21,
              lineHeight: 27,
              color: palette.ink,
            }}
          >
            {settling ? 'bağlanıyor…' : 'kapalı'}
          </Text>
          {!settling ? (
            <Text
              style={{
                fontFamily: 'Inter_400Regular',
                fontSize: 13.5,
                color: palette.ink + '99',
                textAlign: 'center',
              }}
            >
              yaklaşınca otomatik açılır
            </Text>
          ) : null}
        </View>
      ) : null}

      {/* Gate picker — hidden in v1 because auto-selection (first free
          gate on sport change) covers the common case and the manual pill
          row was confusing users who expected one card per door. The block
          stays in the tree behind a feature flag so we can bring it back
          for power users / multi-locker stations later. */}
      {false && selected && allGates.length > 1 ? (
        <View style={{ marginTop: 18 }}>
          <Text
            style={{
              color: palette.ink + 'aa',
              fontSize: 11,
              letterSpacing: 1.2,
              textTransform: 'uppercase',
              fontWeight: '600',
              marginBottom: 8,
            }}
          >
            kapı
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {allGates.map((g) => {
              const taken = takenGateIds.includes(g.id);
              const isSelected = selectedGate?.id === g.id;
              return (
                <Pressable
                  key={g.id}
                  disabled={taken}
                  onPress={async () => {
                    await hx.tap();
                    setSelectedGate(g);
                  }}
                  style={({ pressed }) => ({
                    paddingHorizontal: 14,
                    paddingVertical: 10,
                    borderRadius: 12,
                    backgroundColor: taken
                      ? palette.ink + '08'
                      : isSelected
                      ? palette.ink
                      : palette.ink + '0d',
                    borderWidth: 1,
                    borderColor: isSelected ? palette.ink : palette.ink + '14',
                    opacity: taken ? 0.5 : pressed ? 0.7 : 1,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 6,
                  })}
                >
                  <Text
                    style={{
                      fontFamily: 'Unbounded_700Bold',
                      color: isSelected ? palette.paper : palette.ink,
                      fontSize: 13,
                      letterSpacing: 0.3,
                    }}
                  >
                    {g.label}
                  </Text>
                  {taken ? (
                    <Text
                      style={{
                        fontFamily: 'Inter_600SemiBold',
                        color: palette.ink + '88',
                        fontSize: 11,
                      }}
                    >
                      dolu
                    </Text>
                  ) : null}
                </Pressable>
              );
            })}
          </View>
          {availableGates.length === 0 ? (
            <Text
              style={{
                marginTop: 8,
                fontFamily: 'Inter_600SemiBold',
                color: palette.coral,
                fontSize: 12,
              }}
            >
              tüm kapılar dolu
            </Text>
          ) : null}
        </View>
      ) : null}

      {/* Duration slider — visible while open, grayed when no gate selected;
          fully removed from layout when the station is closed (the "kapalı"
          banner stands in for the whole action area). */}
      <View
        style={{
          marginTop: 36,
          alignItems: 'center',
          opacity: selected ? 1 : 0.35,
          display: open ? 'flex' : 'none',
        }}
        pointerEvents={open && selected ? 'auto' : 'none'}
      >
        <Text
          style={{
            fontSize: 15,
            color: palette.ink,
            letterSpacing: 0.2,
            textAlign: 'center',
            fontWeight: '600',
          }}
        >
          {t('station.duration_question')}
        </Text>

        {/* Big number showing the current value */}
        <View style={{ flexDirection: 'row', alignItems: 'baseline', marginTop: 16 }}>
          <Text
            style={{
              fontFamily: 'Unbounded_800ExtraBold',
              fontSize: 64,
              lineHeight: 83,
              color: palette.ink,
              includeFontPadding: false,
              marginRight: 6,
            }}
          >
            {durationDisplay.big}
          </Text>
          <Text
            style={{
              fontSize: 16,
              color: palette.ink,
              letterSpacing: 0.4,
              fontWeight: '500',
            }}
          >
            {durationDisplay.unit}
          </Text>
        </View>

        {/* Cost preview chip — total estimated charge for the chosen
            duration, KDV included. Live updates as the slider moves. */}
        <View
          style={{
            marginTop: 10,
            flexDirection: 'row',
            alignItems: 'center',
            backgroundColor: palette.surface,
            paddingHorizontal: 14,
            paddingVertical: 8,
            borderRadius: 999,
          }}
        >
          <Text
            style={{
              fontFamily: 'JetBrainsMono_500Medium',
              color: palette.butter,
              fontSize: 11,
              letterSpacing: 0.6,
              marginRight: 8,
              textTransform: 'uppercase',
            }}
          >
            tahmini
          </Text>
          <Text
            style={{
              fontFamily: 'Unbounded_800ExtraBold',
              color: palette.fg,
              fontSize: 16,
              letterSpacing: 0.3,
              marginRight: 8,
            }}
          >
            {formatTry(costForMinutes(duration))}
          </Text>
          <Text
            style={{
              fontFamily: 'JetBrainsMono_500Medium',
              color: palette.fg + 'aa',
              fontSize: 10,
              letterSpacing: 0.5,
            }}
          >
            {formatTry(RATE_PER_MIN_GROSS)}/dk
          </Text>
        </View>

        {/* Slider */}
        <View style={{ width: '100%', marginTop: 12 }}>
          <DurationSlider
            value={duration}
            onChange={(v) => {
              if (v === duration) return;
              if (v % 15 === 0) hx.tap();
              setDuration(v);
            }}
            accent={palette.coral}
            trackColor={palette.ink + '1f'}
            thumbLabelColor={palette.paper}
          />
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 4, marginTop: 6 }}>
            <Text style={{ fontSize: 11, color: palette.ink, fontWeight: '500' }}>
              {DURATION_MIN} dk
            </Text>
            <Text style={{ fontSize: 11, color: palette.ink, fontWeight: '500' }}>
              3 sa
            </Text>
          </View>
        </View>

      </View>

      {/* Active-session banner — highest priority, shown regardless of
          selection so the user understands why they can't start a new flow. */}
      {sessionAtThisStation ? (
        <Animated.View
          entering={FadeInDown.duration(220)}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            marginTop: 24,
            backgroundColor: palette.coral + '22',
            borderRadius: 14,
            paddingHorizontal: 14,
            paddingVertical: 10,
          }}
        >
          <Feather name="play-circle" size={14} color={palette.coral} style={{ marginRight: 8 }} />
          <Text style={{ flex: 1, color: palette.ink, fontSize: 12, fontWeight: '500' }}>
            {t('station.blocked_session_here')}
          </Text>
        </Animated.View>
      ) : null}
      {sessionAtOtherStation ? (
        <Animated.View
          entering={FadeInDown.duration(220)}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            marginTop: 24,
            backgroundColor: palette.coral + '22',
            borderRadius: 14,
            paddingHorizontal: 14,
            paddingVertical: 10,
          }}
        >
          <Feather name="alert-circle" size={14} color={palette.coral} style={{ marginRight: 8 }} />
          <Text style={{ flex: 1, color: palette.ink, fontSize: 12, fontWeight: '500' }}>
            {t('station.blocked_session_elsewhere', {
              name: activeSession?.stationName ?? '',
            })}
          </Text>
        </Animated.View>
      ) : null}

      {/* Terminal "no connection" banner — shown ONLY after the watch has
          given up (UNREACHABLE_MS with no connect). During the checking window
          we show nothing here; the CTA already reads "kontrol ediliyor". This
          kills the old get-closer banner that flickered in/out while the radio
          hunted. Offers a manual retry that re-arms the watch. */}
      {selected && unreachable && !blockedByOtherReservation && !activeSession ? (
        <Animated.View
          entering={FadeInDown.duration(220)}
          style={{
            marginTop: 24,
            backgroundColor: palette.coral + '14',
            borderRadius: 14,
            borderWidth: 1.5,
            borderColor: palette.coral + '44',
            paddingHorizontal: 14,
            paddingVertical: 12,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
            <Feather name="bluetooth" size={14} color={palette.coral} style={{ marginRight: 8 }} />
            <Text style={{ flex: 1, color: palette.ink, fontSize: 12, fontWeight: '500' }}>
              {t('station.no_connection_hint')}
            </Text>
          </View>
          <Pressable
            onPress={() => {
              hx.tap();
              retryProximity();
            }}
            style={({ pressed }) => ({ alignSelf: 'flex-start', opacity: pressed ? 0.7 : 1 })}
          >
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                backgroundColor: palette.surface,
                borderRadius: 10,
                paddingHorizontal: 14,
                paddingVertical: 8,
              }}
            >
              <Feather name="refresh-cw" size={13} color={palette.paper} style={{ marginRight: 7 }} />
              <Text
                style={{
                  fontFamily: 'Unbounded_700Bold',
                  color: palette.fg,
                  fontSize: 12,
                  letterSpacing: 0.4,
                }}
              >
                tekrar dene
              </Text>
            </View>
          </Pressable>
        </Animated.View>
      ) : null}

      {blockedByOtherReservation ? (
        <Animated.View
          entering={FadeInDown.duration(220)}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            marginTop: 24,
            backgroundColor: palette.coral + '22',
            borderRadius: 14,
            paddingHorizontal: 14,
            paddingVertical: 10,
          }}
        >
          <Feather name="alert-circle" size={14} color={palette.coral} style={{ marginRight: 8 }} />
          <Text style={{ flex: 1, color: palette.ink, fontSize: 12, fontWeight: '500' }}>
            {t('station.blocked_by_reservation', {
              name: STATIONS.find((s) => s.id === activeReservation?.station_id)?.name ?? '',
            })}
          </Text>
        </Animated.View>
      ) : null}

      {/* Phase 0 dev pill — shows live BLE state so we can see whether
          proximity is finding the ESP32 or not. DEV-only: end users should
          never see raw proximity state ("BLE: scanning"), which reads as a
          broken/loading UI. */}
      {__DEV__ ? (
        <View
          style={{
            alignSelf: 'flex-start',
            paddingHorizontal: 10,
            paddingVertical: 4,
            marginBottom: 10,
            borderRadius: 999,
            backgroundColor:
              proximityState.kind === 'in_range'
                ? '#0a7d2c'
                : proximityState.kind === 'scanning' || proximityState.kind === 'idle'
                ? '#a06010'
                : '#a01010',
          }}
        >
          <Text
            style={{
              fontFamily: 'JetBrainsMono_700Bold',
              fontSize: 10,
              color: '#fff',
              letterSpacing: 0.5,
            }}
          >
            BLE: {proximityState.kind}
            {proximityState.kind === 'in_range'
              ? ` (rssi ${proximityState.rssi})`
              : ''}
          </Text>
        </View>
      ) : null}

      {open ? (
        <View style={{ marginTop: 32 }} pointerEvents={sessionAtOtherStation ? 'none' : 'auto'}>
          {/* Hint above the CTA — centered, muted. */}
          <Text
            style={{
              fontFamily: 'JetBrainsMono_500Medium',
              fontSize: 12,
              color: palette.muted,
              textAlign: 'center',
              letterSpacing: 0.3,
              marginBottom: 14,
            }}
          >
            açmak için istasyona yaklaş 🛰
          </Text>
          {/* Primary CTA — full-width VOLT pill. onPress/label logic unchanged. */}
          <Button
            label={ctaLabel}
            onPress={onPress}
            variant="primary"
            disabled={!ctaEnabled}
          />
        </View>
      ) : null}

      {/* Always-visible secondary "Rezerve et". Lets the user hold a gate
          remotely; the primary "open gate" button stays put on top and
          shows an out-of-range modal if tapped from afar. */}
      {!!selected && stockOk && !!selectedGate && !sessionAtThisStation && !sessionAtOtherStation ? (
        <Pressable
          onPress={onReservePress}
          style={({ pressed }) => ({ marginTop: 18, alignSelf: 'center', opacity: pressed ? 0.6 : 1 })}
        >
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              paddingVertical: 7,
              paddingHorizontal: 12,
              borderRadius: 10,
              borderWidth: 1.5,
              borderColor: palette.ink + '2e',
              backgroundColor: palette.paper,
            }}
          >
            <Feather name="clock" size={12} color={palette.ink + 'aa'} style={{ marginRight: 6 }} />
            <Text
              style={{
                fontFamily: 'Unbounded_700Bold',
                color: palette.ink + 'aa',
                fontSize: 11.5,
                letterSpacing: 0.2,
              }}
            >
              rezerve et
            </Text>
          </View>
        </Pressable>
      ) : null}
    </View>
  );
}

