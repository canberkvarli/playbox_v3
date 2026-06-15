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
  Easing,
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
import { costForMinutes, formatTry, RATE_PER_MIN_GROSS } from '@/lib/pricing';
import { SPORT_EMOJI } from '@/data/sports';
import { gatesForStation, SPORT_LABELS, type Gate, type Station, type Sport } from '@/data/stations.seed';
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

  const cardStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + sel.value * 0.05 - press.value * 0.04 }],
    borderColor: selected ? palette.coral : palette.ink + '33',
    borderWidth: 2,
    // Subtle ink tint when unselected so the card doesn't visually
    // disappear against the paper background of the screen.
    backgroundColor: selected ? palette.butter : palette.ink + '0d',
  }));

  const ringStyle = useAnimatedStyle(() => ({
    opacity: sel.value,
    transform: [{ scale: 0.6 + sel.value * 0.4 }],
  }));

  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      onPressIn={() => (press.value = withTiming(1, { duration: 80 }))}
      onPressOut={() => (press.value = withTiming(0, { duration: 120 }))}
      style={{ flexBasis: '30%', flexGrow: 1, opacity: disabled ? 0.4 : 1 }}
    >
      <Animated.View
        style={[
          {
            borderRadius: 24,
            paddingVertical: 16,
            paddingHorizontal: 10,
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: 134,
            position: 'relative',
            overflow: 'hidden',
          },
          cardStyle,
        ]}
      >
        <Animated.View
          style={[
            {
              position: 'absolute',
              top: 6,
              right: 6,
              width: 18,
              height: 18,
              borderRadius: 9,
              backgroundColor: palette.coral,
              alignItems: 'center',
              justifyContent: 'center',
            },
            ringStyle,
          ]}
        >
          <Feather name="check" size={11} color={palette.paper} />
        </Animated.View>
        <Text style={{ fontSize: 40 }}>{SPORT_EMOJI[sport]}</Text>
        <Text
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.7}
          style={{
            fontFamily: 'Unbounded_700Bold',
            fontSize: 13,
            color: palette.ink,
            marginTop: 6,
            textTransform: 'lowercase',
            letterSpacing: 0,
            width: '100%',
            textAlign: 'center',
          }}
        >
          {SPORT_LABELS[sport]}
        </Text>
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
};

export function StationGateSelector({
  station,
  onUnlock,
  unlocking,
}: StationGateSelectorProps) {
  const { t } = useT();
  const router = useRouter();
  const { inRange, state: proximityState } = useStationInRange(station.id);
  const proximityFar = proximityState.kind === 'out_of_range';
  // True while BLE is still finding the answer ("scanning"/"idle"). During
  // this window we don't yet know whether the user is close enough — the
  // CTA must not be tappable, otherwise they'll punch OYNA and get the
  // out-of-range modal even when they're actually right next to it.
  const proximityResolving =
    proximityState.kind === 'idle' || proximityState.kind === 'scanning';

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
    // Don't let the user tap OYNA while we're still resolving BLE
    // proximity. Without this gate they get the "yaklaş" modal during
    // the scan window even when they're actually close.
    !proximityResolving;
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
    : proximityResolving
    ? t('station.checking_proximity')
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
          color: palette.ink,
          fontSize: 11,
          letterSpacing: 1.2,
          textTransform: 'uppercase',
          fontWeight: '600',
          marginBottom: 12,
        }}
      >
        {t('station.gates_label')}
      </Text>
      <View
        style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}
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

      {/* Duration slider — always visible, grayed when no gate selected */}
      <View
        style={{ marginTop: 36, alignItems: 'center', opacity: selected ? 1 : 0.35 }}
        pointerEvents={selected ? 'auto' : 'none'}
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
              lineHeight: 68,
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
            backgroundColor: palette.ink,
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
              color: palette.paper,
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
              color: palette.paper + 'aa',
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

      {/* Status hint banner — only show after BLE has *confirmed* the
          station is out of range. During the initial scanning phase
          (the first ~½ second after mount) we suppress the banner so
          users near the station don't see a "get closer" flash. */}
      {selected && proximityFar && !blockedByOtherReservation && !activeSession ? (
        <Animated.View
          entering={FadeInDown.duration(220)}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            marginTop: 24,
            backgroundColor: palette.butter,
            borderRadius: 14,
            paddingHorizontal: 14,
            paddingVertical: 10,
          }}
        >
          <Feather name="bluetooth" size={14} color={palette.ink} style={{ marginRight: 8 }} />
          <Text style={{ flex: 1, color: palette.ink, fontSize: 12, fontWeight: '500' }}>
            {t('station.range_hint')}
          </Text>
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
              name: activeReservation?.stationName ?? '',
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

      <CTAButton
        label={ctaLabel}
        bg={palette.coral}
        enabled={ctaEnabled}
        hardBlocked={sessionAtOtherStation}
        onPress={onPress}
      />

      {/* Always-visible secondary "Rezerve et". Lets the user hold a gate
          remotely; the primary "open gate" button stays put on top and
          shows an out-of-range modal if tapped from afar. */}
      {!!selected && stockOk && !!selectedGate && !sessionAtThisStation && !sessionAtOtherStation ? (
        <Pressable
          onPress={onReservePress}
          style={({ pressed }) => ({ marginTop: 22, opacity: pressed ? 0.65 : 1 })}
        >
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              paddingVertical: 16,
              borderRadius: 18,
              borderWidth: 2,
              borderColor: palette.ink,
              backgroundColor: palette.paper,
            }}
          >
            <Feather name="clock" size={18} color={palette.ink} style={{ marginRight: 10 }} />
            <Text
              style={{
                fontFamily: 'Unbounded_800ExtraBold',
                color: palette.ink,
                fontSize: 16,
                letterSpacing: 0.4,
              }}
            >
              REZERVE ET
            </Text>
          </View>
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * Animated CTA button. Springs in scale and shadow when it becomes actionable
 * (e.g. user picks a gate and "bir kapı seç" turns into "oyna"). The bg colour
 * lives on an inner View — Pressable function-style props were dropping the
 * backgroundColor on this RN build, leaving the button as white-on-white.
 */
function CTAButton({
  label,
  bg,
  enabled,
  hardBlocked,
  onPress,
}: {
  label: string;
  bg: string;
  enabled: boolean;
  hardBlocked: boolean;
  onPress: () => void;
}) {
  const activate = useSharedValue(enabled ? 1 : 0);
  const press = useSharedValue(0);

  useEffect(() => {
    activate.value = withSpring(enabled ? 1 : 0, { damping: 14, stiffness: 180 });
  }, [enabled, activate]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + activate.value * 0.02 - press.value * 0.04 }],
    opacity: hardBlocked ? 0.5 : 0.7 + activate.value * 0.3,
  }));

  return (
    <View
      style={{ marginTop: 32 }}
      pointerEvents={hardBlocked ? 'none' : 'auto'}
    >
      <Pressable
        onPress={onPress}
        disabled={!enabled}
        onPressIn={() => (press.value = withTiming(1, { duration: 80 }))}
        onPressOut={() => (press.value = withTiming(0, { duration: 120, easing: Easing.out(Easing.cubic) }))}
      >
        <Animated.View
          style={[
            {
              width: '100%',
              backgroundColor: bg,
              borderRadius: 28,
              paddingVertical: 24,
              alignItems: 'center',
              justifyContent: 'center',
              shadowColor: bg,
              shadowOffset: { width: 0, height: 10 },
              shadowOpacity: enabled ? 0.35 : 0.15,
              shadowRadius: 20,
              elevation: enabled ? 12 : 4,
            },
            animatedStyle,
          ]}
        >
          <Animated.Text
            // Re-mount on label change so FadeIn re-runs and the label
            // crossfades when state flips (e.g. "bir kapı seç" → "oyna").
            key={label}
            entering={FadeInDown.duration(180)}
            style={{
              fontFamily: 'Unbounded_800ExtraBold',
              color: palette.paper,
              letterSpacing: 2,
              fontSize: 26,
              lineHeight: 30,
              textAlign: 'center',
              includeFontPadding: false,
            }}
          >
            {label}
          </Animated.Text>
        </Animated.View>
      </Pressable>
    </View>
  );
}
