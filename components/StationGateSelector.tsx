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
            padding: 16,
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
        <Text
          style={{
            fontFamily: 'JetBrainsMono_400Regular',
            fontSize: 11,
            color: palette.ink,
            letterSpacing: 0.6,
            marginBottom: 6,
          }}
        >
          Kapı {index + 1}
        </Text>
        <Text style={{ fontSize: 40 }}>{SPORT_EMOJI[sport]}</Text>
        <Text
          numberOfLines={1}
          style={{
            fontFamily: 'Unbounded_700Bold',
            fontSize: 14,
            color: palette.ink,
            marginTop: 6,
            textTransform: 'lowercase',
            letterSpacing: 0.2,
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
  onUnlock: (sport: Sport, durationMinutes: number) => void | Promise<void>;
  unlocking?: boolean;
};

export function StationGateSelector({
  station,
  onUnlock,
  unlocking,
}: StationGateSelectorProps) {
  const { t } = useT();
  const router = useRouter();
  const { inRange } = useStationInRange(station.id);

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

  // Reservation flow trigger: not in range + selected + station available + at
  // least one free gate left after subtracting active reservations.
  const reserveMode = !!selected && stockOk && !inRange && !activeReservation && !!selectedGate;
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
    !sessionAtThisStation;
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
    : reserveMode
    ? t('station.cta_reserve', { min: RESERVATION_LOCK_MIN })
    : t('station.cta_unlock');

  const onSelect = async (sp: Sport) => {
    await hx.tap();
    setSelected((prev) => (prev === sp ? null : sp));
  };

  const onPress = async () => {
    // Session-active override: if a session is open here, the CTA should just
    // take them to the Play tab. Different station → hard stop (no CTA tap).
    if (sessionAtThisStation) {
      await hx.tap();
      router.replace('/(tabs)/play');
      return;
    }
    if (!ctaEnabled || !selected) return;
    if (reserveMode && selectedGate) {
      await hx.press();
      // Hand off to the new reserve flow — slides on first reservation,
      // mini-confirm thereafter. The server validates everything (card,
      // lock, terms, capacity, velocity) and surfaces clean errors.
      router.push({
        pathname: '/reserve/[stationId]/[sport]/[gateId]' as const,
        params: {
          stationId: station.id,
          sport: selected,
          gateId: selectedGate.id,
        },
      });
      return;
    }
    await hx.press();
    onUnlock(selected, duration);
  };

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

      {/* Gate picker — only when a sport with multiple gates is selected.
          Single-gate sports skip this UI and just auto-select the gate. */}
      {selected && allGates.length > 1 ? (
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

        <Text
          style={{
            fontSize: 11,
            color: palette.ink,
            letterSpacing: 0.4,
            marginTop: 8,
            textAlign: 'center',
            fontWeight: '500',
          }}
        >
          {t('station.duration_hint')}
        </Text>
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

      {/* Status hint banner — explains why CTA is what it is */}
      {selected && !inRange && !blockedByOtherReservation && !activeSession ? (
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
            {reserveMode ? t('station.range_hint_reserve') : t('station.range_hint')}
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

      <CTAButton
        label={ctaLabel}
        bg={reserveMode ? palette.ink : palette.coral}
        enabled={ctaEnabled}
        hardBlocked={sessionAtOtherStation}
        onPress={onPress}
      />

      {/* Always-visible secondary "Rezerve et" — even when the user is in
          range, they may want to hold the gate while they finish errands.
          Hidden in reserveMode (the primary button already does this) and
          when no gate is selected or stock is empty. */}
      {!!selected && stockOk && !reserveMode && !!selectedGate && !sessionAtThisStation && !sessionAtOtherStation ? (
        <Pressable
          onPress={async () => {
            await hx.press();
            router.push({
              pathname: '/reserve/[stationId]/[sport]/[gateId]' as const,
              params: {
                stationId: station.id,
                sport: selected,
                gateId: selectedGate.id,
              },
            });
          }}
          style={({ pressed }) => ({ marginTop: 12, opacity: pressed ? 0.65 : 1 })}
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
