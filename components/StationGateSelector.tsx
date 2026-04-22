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

import { useT } from '@/hooks/useT';
import { useTheme } from '@/hooks/useTheme';
import { hx } from '@/lib/haptics';
import { palette } from '@/constants/theme';
import { SPORT_EMOJI } from '@/data/sports';
import { SPORT_LABELS, type Station, type Sport } from '@/data/stations.seed';
import { useStationInRange } from '@/lib/ble/useStationInRange';
import {
  useReservationStore,
  RESERVATION_LOCK_MIN,
} from '@/stores/reservationStore';

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
  const theme = useTheme();
  const press = useSharedValue(0);
  const sel = useSharedValue(selected ? 1 : 0);

  useEffect(() => {
    sel.value = withSpring(selected ? 1 : 0, { damping: 14, stiffness: 220 });
  }, [selected, sel]);

  const cardStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + sel.value * 0.05 - press.value * 0.04 }],
    borderColor: selected ? palette.coral : theme.fg + '14',
    borderWidth: 1.5,
    backgroundColor: selected ? palette.butter : theme.bg,
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
          className="font-mono"
          style={{
            fontSize: 11,
            color: palette.ink + 'aa',
            letterSpacing: 0.6,
            marginBottom: 6,
          }}
        >
          Kapı {index + 1}
        </Text>
        <Text style={{ fontSize: 40 }}>{SPORT_EMOJI[sport]}</Text>
        <Text
          className="font-display"
          style={{
            fontSize: 14,
            color: palette.ink,
            marginTop: 6,
            textTransform: 'lowercase',
            letterSpacing: 0.2,
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
  const theme = useTheme();
  const { inRange } = useStationInRange(station.id);

  const reserve = useReservationStore((s) => s.reserve);
  const activeReservation = useReservationStore((s) =>
    s.reservations.find(
      (r) => r.status === 'active' && r.expiresAt > Date.now()
    ) ?? null
  );

  const [selected, setSelected] = useState<Sport | null>(null);
  const [duration, setDuration] = useState(DURATION_DEFAULT);
  const [reserving, setReserving] = useState(false);

  const durationDisplay = formatDuration(duration);

  const stockOk = useMemo(() => {
    if (!selected) return false;
    return (station.stock[selected] ?? 0) > 0;
  }, [selected, station]);

  // Reservation flow trigger: not in range + selected + station available
  const reserveMode = !!selected && stockOk && !inRange && !activeReservation;
  const blockedByOtherReservation =
    !!activeReservation && activeReservation.stationId !== station.id;

  const ctaEnabled = !!selected && stockOk && !unlocking && !reserving && !blockedByOtherReservation;

  const ctaLabel = unlocking
    ? t('station.unlocking')
    : reserving
    ? t('station.reserving')
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
    if (!ctaEnabled || !selected) return;
    if (reserveMode) {
      setReserving(true);
      await hx.press();
      const result = reserve({
        stationId: station.id,
        stationName: station.name,
        sport: selected,
      });
      setReserving(false);
      if ('error' in result) {
        const msg =
          result.error === 'has_active'
            ? t('station.reserve_err_has_active')
            : t('station.reserve_err_cooldown');
        Alert.alert(t('common.error_generic'), msg);
        return;
      }
      Alert.alert(
        t('station.reserved_title'),
        t('station.reserved_msg', {
          name: station.name,
          min: result.lockMinutes,
        })
      );
      return;
    }
    await hx.press();
    onUnlock(selected, duration);
  };

  return (
    <View>
      {/* Gates */}
      <Text className="font-medium text-ink/60 dark:text-paper/60 uppercase tracking-wider text-xs mb-3">
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

      {/* Duration slider — always visible, grayed when no gate selected */}
      <View
        style={{ marginTop: 36, alignItems: 'center', opacity: selected ? 1 : 0.35 }}
        pointerEvents={selected ? 'auto' : 'none'}
      >
        <Text
          className="font-display"
          style={{
            fontSize: 15,
            color: theme.fg,
            letterSpacing: 0.2,
            textAlign: 'center',
          }}
        >
          {t('station.duration_question')}
        </Text>

        {/* Big number showing the current value */}
        <View style={{ flexDirection: 'row', alignItems: 'baseline', marginTop: 16, gap: 6 }}>
          <Text
            className="font-display-x"
            style={{
              fontSize: 64,
              lineHeight: 68,
              color: theme.fg,
              includeFontPadding: false,
            }}
          >
            {durationDisplay.big}
          </Text>
          <Text
            className="font-mono"
            style={{
              fontSize: 16,
              color: theme.fg + 'aa',
              letterSpacing: 0.4,
            }}
          >
            {durationDisplay.unit}
          </Text>
        </View>

        {/* Slider */}
        <View style={{ width: '100%', marginTop: 12 }}>
          <DurationSlider
            value={duration}
            onChange={(v) => {
              if (v !== duration) {
                hx.tap();
                setDuration(v);
              }
            }}
            accent={palette.coral}
            trackColor={theme.fg + '1f'}
            thumbLabelColor={theme.bg}
          />
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 4, marginTop: 6 }}>
            <Text className="font-mono" style={{ fontSize: 11, color: theme.fg + '88' }}>
              {DURATION_MIN} dk
            </Text>
            <Text className="font-mono" style={{ fontSize: 11, color: theme.fg + '88' }}>
              3 sa
            </Text>
          </View>
          {/* Quick preset chips — lets users snap to common durations without dragging */}
          <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
            {[30, 60, 90, 120, 180].map((m) => {
              const active = duration === m;
              return (
                <Pressable
                  key={m}
                  onPress={async () => {
                    await hx.tap();
                    setDuration(m);
                  }}
                  style={{
                    paddingHorizontal: 12,
                    paddingVertical: 7,
                    borderRadius: 999,
                    backgroundColor: active ? palette.ink : theme.fg + '0d',
                    borderWidth: 1,
                    borderColor: active ? palette.ink : theme.fg + '14',
                  }}
                >
                  <Text
                    className="font-mono"
                    style={{
                      fontSize: 11,
                      color: active ? palette.paper : theme.fg + 'aa',
                      letterSpacing: 0.3,
                      fontWeight: '600',
                    }}
                  >
                    {m < 60 ? `${m} dk` : m % 60 === 0 ? `${m / 60} sa` : `${Math.floor(m / 60)}s ${m % 60}d`}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <Text
          className="font-mono"
          style={{
            fontSize: 11,
            color: theme.fg + '77',
            letterSpacing: 0.4,
            marginTop: 8,
            textAlign: 'center',
          }}
        >
          {t('station.duration_hint')}
        </Text>
      </View>

      {/* Status hint banner — explains why CTA is what it is */}
      {selected && !inRange && !blockedByOtherReservation ? (
        <Animated.View
          entering={FadeInDown.duration(220)}
          className="flex-row items-center gap-2 mt-6"
          style={{
            backgroundColor: palette.butter,
            borderRadius: 14,
            paddingHorizontal: 14,
            paddingVertical: 10,
          }}
        >
          <Feather name="bluetooth" size={14} color={palette.ink} />
          <Text className="font-mono text-ink text-xs flex-1">
            {reserveMode ? t('station.range_hint_reserve') : t('station.range_hint')}
          </Text>
        </Animated.View>
      ) : null}

      {blockedByOtherReservation ? (
        <Animated.View
          entering={FadeInDown.duration(220)}
          className="flex-row items-center gap-2 mt-6"
          style={{
            backgroundColor: palette.coral + '22',
            borderRadius: 14,
            paddingHorizontal: 14,
            paddingVertical: 10,
          }}
        >
          <Feather name="alert-circle" size={14} color={palette.coral} />
          <Text className="font-mono text-ink text-xs flex-1">
            {t('station.blocked_by_reservation', {
              name: activeReservation?.stationName ?? '',
            })}
          </Text>
        </Animated.View>
      ) : null}

      {/* CTA — OYNA or REZERVE ET depending on range/state. Animates in with the duration row. */}
      <View
        style={{ alignItems: 'center', marginTop: 32, opacity: selected ? 1 : 0.35 }}
        pointerEvents={selected ? 'auto' : 'none'}
      >
        <Pressable
          onPress={onPress}
          disabled={!ctaEnabled}
          style={({ pressed }) => ({
            width: '100%',
            backgroundColor: ctaEnabled
              ? reserveMode
                ? palette.ink
                : palette.coral
              : palette.mauve + '33',
            borderRadius: 28,
            paddingVertical: 24,
            alignItems: 'center',
            justifyContent: 'center',
            borderWidth: ctaEnabled ? 0 : 2,
            borderColor: ctaEnabled ? 'transparent' : theme.fg + '33',
            shadowColor: ctaEnabled
              ? reserveMode
                ? palette.ink
                : palette.coral
              : 'transparent',
            shadowOffset: { width: 0, height: 10 },
            shadowOpacity: ctaEnabled ? 0.35 : 0,
            shadowRadius: 20,
            elevation: ctaEnabled ? 12 : 0,
            transform: [{ scale: pressed && ctaEnabled ? 0.97 : 1 }],
          })}
        >
          <Text
            className="font-display-x"
            style={{
              color: ctaEnabled ? palette.paper : theme.fg + 'cc',
              letterSpacing: 2,
              fontSize: 28,
              lineHeight: 32,
              textAlign: 'center',
              includeFontPadding: false,
            }}
          >
            {ctaLabel}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
