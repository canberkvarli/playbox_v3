import { useEffect } from 'react';
import { View, Text, Pressable } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { Feather } from '@expo/vector-icons';

import { palette } from '@/constants/theme';
import { hx } from '@/lib/haptics';
import { SportBall } from '@/components/ui/SportBall';
import { SPORT_LABELS, type Sport, type Station } from '@/data/stations.seed';

type CellState = 'available' | 'out' | 'empty';

type Props = {
  station: Station;
  open: boolean;
  selected: Sport | null;
  onSelect: (s: Sport) => void;
};

/**
 * The station's sports shown as an abstract Playbox locker: a grid of
 * compartments, each with a volt line-art ball behind a door. Tapping an
 * available compartment opens its door (ball pops in, haptic) and selects the
 * sport; out-of-stock compartments stay shut and shake + buzz on tap.
 */
export function LockerSelector({ station, open, selected, onSelect }: Props) {
  const sports = station.sports;
  const count = Math.max(2, sports.length % 2 === 0 ? sports.length : sports.length + 1);
  const cells = Array.from({ length: count }, (_, i) => sports[i] ?? null);

  return (
    <View
      pointerEvents={open ? 'auto' : 'none'}
      style={{ opacity: open ? 1 : 0.5 }}
    >
      {/* Locker body */}
      <View
        style={{
          backgroundColor: palette.surface,
          borderRadius: 22,
          borderWidth: 1.5,
          borderColor: palette.border,
          padding: 12,
        }}
      >
        {/* hinge/etch strip */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingHorizontal: 4,
            marginBottom: 10,
          }}
        >
          <View style={{ flexDirection: 'row', gap: 5 }}>
            {[0, 1, 2].map((i) => (
              <View
                key={i}
                style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: palette.border }}
              />
            ))}
          </View>
          <Text
            style={{
              fontFamily: 'JetBrainsMono_500Medium',
              fontSize: 9,
              letterSpacing: 3,
              color: palette.muted,
            }}
          >
            PLAYBOX
          </Text>
        </View>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          {cells.map((sport, i) => {
            const state: CellState =
              sport == null ? 'empty' : (station.stock[sport] ?? 0) === 0 ? 'out' : 'available';
            return (
              <LockerCell
                key={sport ?? `empty-${i}`}
                sport={sport}
                state={state}
                selected={sport != null && selected === sport}
                onPress={() => sport && onSelect(sport)}
              />
            );
          })}
        </View>
      </View>
    </View>
  );
}

function LockerCell({
  sport,
  state,
  selected,
  onPress,
}: {
  sport: Sport | null;
  state: CellState;
  selected: boolean;
  onPress: () => void;
}) {
  const doorOpen = useSharedValue(selected ? 1 : 0);
  const shake = useSharedValue(0);

  useEffect(() => {
    doorOpen.value = withSpring(selected ? 1 : 0, { damping: 15, stiffness: 200 });
  }, [selected, doorOpen]);

  const doorStyle = useAnimatedStyle(() => ({
    opacity: 0.82 * (1 - doorOpen.value),
    transform: [{ translateY: -doorOpen.value * 96 }],
  }));
  const voltBallStyle = useAnimatedStyle(() => ({
    opacity: doorOpen.value,
    transform: [{ scale: 0.7 + doorOpen.value * 0.3 }],
  }));
  const shakeStyle = useAnimatedStyle(() => ({ transform: [{ translateX: shake.value }] }));

  const onTap = () => {
    if (state === 'empty') return;
    if (state === 'out') {
      hx.no();
      shake.value = withSequence(
        withTiming(-7, { duration: 45 }),
        withTiming(7, { duration: 45 }),
        withTiming(-5, { duration: 45 }),
        withTiming(4, { duration: 45 }),
        withTiming(0, { duration: 45 }),
      );
      return;
    }
    hx.tap();
    onPress();
  };

  const ballColor = state === 'available' ? palette.muted : palette.border;

  return (
    <Pressable onPress={onTap} disabled={state === 'empty'} style={{ width: '47%', flexGrow: 1 }}>
      <Animated.View
        style={[
          {
            height: 118,
            borderRadius: 16,
            borderWidth: selected ? 2 : 1,
            borderColor: selected ? palette.volt : palette.border,
            backgroundColor: palette.surfaceAlt,
            overflow: 'hidden',
            alignItems: 'center',
            justifyContent: 'center',
            opacity: state === 'empty' ? 0.45 : 1,
          },
          shakeStyle,
        ]}
      >
        {/* Ball area */}
        {sport ? (
          <View style={{ width: 96, height: 96, alignItems: 'center', justifyContent: 'center' }}>
            {/* grey base ball (faintly visible through the door) */}
            <View style={{ position: 'absolute' }}>
              <SportBall sport={sport} color={ballColor} size={56} />
            </View>
            {/* bright volt ball — revealed as the door opens */}
            <Animated.View style={[{ position: 'absolute' }, voltBallStyle]}>
              <SportBall sport={sport} color={palette.volt} size={56} />
            </Animated.View>
          </View>
        ) : (
          <Feather name="lock" size={22} color={palette.border} />
        )}

        {/* Door — slides up + fades to reveal the ball */}
        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: palette.surface,
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
            },
            doorStyle,
          ]}
        >
          {/* vent slats + handle for a locker-door look */}
          {[0, 1, 2].map((i) => (
            <View
              key={i}
              style={{ width: 46, height: 3, borderRadius: 2, backgroundColor: palette.border }}
            />
          ))}
          <View
            style={{
              position: 'absolute',
              right: 10,
              width: 8,
              height: 18,
              borderRadius: 4,
              backgroundColor: palette.border,
            }}
          />
        </Animated.View>

        {/* out-of-stock tag */}
        {state === 'out' ? (
          <View
            style={{
              position: 'absolute',
              top: 8,
              right: 8,
              backgroundColor: palette.danger,
              borderRadius: 7,
              paddingHorizontal: 7,
              paddingVertical: 2,
            }}
          >
            <Text
              style={{ fontFamily: 'Inter_600SemiBold', fontSize: 9, letterSpacing: 0.4, color: palette.fg }}
            >
              DOLU
            </Text>
          </View>
        ) : null}
      </Animated.View>

      {/* label */}
      <Text
        numberOfLines={1}
        style={{
          textAlign: 'center',
          marginTop: 8,
          fontFamily: 'Inter_600SemiBold',
          fontSize: 13,
          color: selected ? palette.volt : state === 'available' ? palette.fg : palette.muted,
        }}
      >
        {sport ? SPORT_LABELS[sport] : ''}
      </Text>
    </Pressable>
  );
}
