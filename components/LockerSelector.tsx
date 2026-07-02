import { useEffect } from 'react';
import { View, Text, Pressable } from 'react-native';
import Animated, {
  interpolate,
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

type Props = {
  station: Station;
  open: boolean;
  selected: Sport | null;
  onSelect: (s: Sport) => void;
};

/**
 * The station's sports as an abstract Playbox locker TOWER — a tall body with
 * one stacked compartment per sport (matches the physical 3-gate unit). Each
 * compartment is a door with a volt line-art ball behind it; tapping an
 * available door swings it open (ball pops, haptic) and selects the sport.
 * Out-of-stock doors stay shut and shake + buzz.
 */
export function LockerSelector({ station, open, selected, onSelect }: Props) {
  return (
    <View pointerEvents={open ? 'auto' : 'none'} style={{ opacity: open ? 1 : 0.5 }}>
      <View
        style={{
          backgroundColor: palette.surface,
          borderRadius: 20,
          borderWidth: 1.5,
          borderColor: palette.border,
          padding: 10,
        }}
      >
        {/* top strip — hinge bolts + etch */}
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

        <View style={{ gap: 8 }}>
          {station.sports.map((sport) => {
            const out = (station.stock[sport] ?? 0) === 0;
            return (
              <Compartment
                key={sport}
                sport={sport}
                out={out}
                selected={selected === sport}
                onPress={() => onSelect(sport)}
              />
            );
          })}
        </View>
      </View>
    </View>
  );
}

function Compartment({
  sport,
  out,
  selected,
  onPress,
}: {
  sport: Sport;
  out: boolean;
  selected: boolean;
  onPress: () => void;
}) {
  const openV = useSharedValue(selected ? 1 : 0);
  const shake = useSharedValue(0);

  useEffect(() => {
    openV.value = withSpring(selected ? 1 : 0, { damping: 16, stiffness: 180 });
  }, [selected, openV]);

  const doorStyle = useAnimatedStyle(() => ({
    opacity: interpolate(openV.value, [0, 0.75, 1], [1, 1, 0]),
    transform: [
      { perspective: 700 },
      { rotateY: `${-openV.value * 108}deg` },
    ],
  }));
  const voltBallStyle = useAnimatedStyle(() => ({
    opacity: openV.value,
    transform: [{ scale: 0.7 + openV.value * 0.3 }],
  }));
  const shakeStyle = useAnimatedStyle(() => ({ transform: [{ translateX: shake.value }] }));

  const onTap = () => {
    if (out) {
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

  return (
    <Pressable onPress={onTap} style={{ borderRadius: 14 }}>
      <Animated.View
        style={[
          {
            height: 78,
            borderRadius: 14,
            borderWidth: selected ? 2 : 1,
            borderColor: selected ? palette.volt : palette.border,
            backgroundColor: palette.surfaceAlt,
            overflow: 'hidden',
          },
          shakeStyle,
        ]}
      >
        {/* Interior (revealed when the door swings open) */}
        <View
          style={{
            ...StyleFill,
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: 14,
            gap: 14,
          }}
        >
          <View style={{ width: 52, height: 52, alignItems: 'center', justifyContent: 'center' }}>
            <View style={{ position: 'absolute' }}>
              <SportBall sport={sport} color={out ? palette.border : palette.muted} size={50} />
            </View>
            <Animated.View style={[{ position: 'absolute' }, voltBallStyle]}>
              <SportBall sport={sport} color={palette.volt} size={50} />
            </Animated.View>
          </View>
          <Text
            style={{
              flex: 1,
              fontFamily: 'Unbounded_800ExtraBold',
              fontSize: 17,
              textTransform: 'uppercase',
              color: selected ? palette.volt : palette.fg,
            }}
          >
            {SPORT_LABELS[sport]}
          </Text>
          {selected ? (
            <Feather name="unlock" size={18} color={palette.volt} />
          ) : null}
        </View>

        {/* Door face (hinged left, swings open on select) */}
        <Animated.View
          style={[
            {
              ...StyleFill,
              transformOrigin: 'left center',
              backfaceVisibility: 'hidden',
              backgroundColor: palette.surface,
              borderRadius: 14,
              flexDirection: 'row',
              alignItems: 'center',
              paddingHorizontal: 14,
              gap: 12,
            },
            doorStyle,
          ]}
        >
          {/* vent slats */}
          <View style={{ gap: 5 }}>
            {[0, 1, 2].map((i) => (
              <View
                key={i}
                style={{ width: 34, height: 3, borderRadius: 2, backgroundColor: palette.border }}
              />
            ))}
          </View>
          <Text
            style={{
              flex: 1,
              fontFamily: 'Unbounded_800ExtraBold',
              fontSize: 17,
              textTransform: 'uppercase',
              color: out ? palette.muted : palette.fg,
            }}
          >
            {SPORT_LABELS[sport]}
          </Text>
          {out ? (
            <View
              style={{
                backgroundColor: palette.danger,
                borderRadius: 7,
                paddingHorizontal: 8,
                paddingVertical: 3,
              }}
            >
              <Text
                style={{ fontFamily: 'Inter_600SemiBold', fontSize: 10, letterSpacing: 0.4, color: palette.fg }}
              >
                DOLU
              </Text>
            </View>
          ) : (
            // handle/latch
            <View
              style={{
                width: 10,
                height: 26,
                borderRadius: 5,
                backgroundColor: palette.border,
              }}
            />
          )}
        </Animated.View>
      </Animated.View>
    </Pressable>
  );
}

const StyleFill = {
  position: 'absolute' as const,
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
};
