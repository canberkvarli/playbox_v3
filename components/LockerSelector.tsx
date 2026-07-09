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

type Props = {
  station: Station;
  open: boolean;
  selected: Sport | null;
  onSelect: (s: Sport) => void;
};

/**
 * The station's sports shown as a Playbox locker: a framed box (PLAYBOX ·
 * <station> header + hinge dashes) holding one compartment row per sport. Each
 * row has a volt line-art ball, the sport name, and a müsait/tükendi status.
 * Selected = volt border + left bar + check; out-of-stock dims and shakes.
 */
export function LockerSelector({ station, open, selected, onSelect }: Props) {
  const shortName = station.name.split(' ')[0].toUpperCase();
  return (
    <View pointerEvents={open ? 'auto' : 'none'} style={{ opacity: open ? 1 : 0.5 }}>
      <View
        style={{
          backgroundColor: palette.surface,
          borderRadius: 22,
          borderWidth: 1,
          borderColor: palette.border,
          padding: 12,
        }}
      >
        {/* header: PLAYBOX · <station>  +  hinge dashes */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingHorizontal: 4,
            marginBottom: 12,
          }}
        >
          <Text
            style={{
              fontFamily: 'JetBrainsMono_500Medium',
              fontSize: 11,
              letterSpacing: 2,
              color: palette.volt,
            }}
          >
            {`PLAYBOX · ${shortName}`}
          </Text>
          <View style={{ flexDirection: 'row', gap: 5 }}>
            {[0, 1, 2].map((i) => (
              <View
                key={i}
                style={{ width: 15, height: 3, borderRadius: 2, backgroundColor: palette.border }}
              />
            ))}
          </View>
        </View>

        <View style={{ gap: 10 }}>
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
  const sel = useSharedValue(selected ? 1 : 0);
  const shake = useSharedValue(0);

  useEffect(() => {
    sel.value = withSpring(selected ? 1 : 0, { damping: 15, stiffness: 200 });
  }, [selected, sel]);

  const checkStyle = useAnimatedStyle(() => ({
    opacity: sel.value,
    transform: [{ scale: 0.4 + sel.value * 0.6 }],
  }));
  const barStyle = useAnimatedStyle(() => ({ opacity: sel.value, transform: [{ scaleY: sel.value }] }));
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
    <Pressable onPress={onTap} style={{ borderRadius: 16 }}>
      <Animated.View
        style={[
          {
            height: 80,
            borderRadius: 16,
            borderWidth: selected ? 2 : 1,
            borderColor: selected ? palette.volt : palette.border,
            backgroundColor: selected ? palette.volt + '12' : palette.bg,
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: 16,
            gap: 14,
            overflow: 'hidden',
            opacity: out ? 0.5 : 1,
          },
          shakeStyle,
        ]}
      >
        {/* volt left accent bar (selected) */}
        <Animated.View
          style={[
            {
              position: 'absolute',
              left: 0,
              top: 16,
              bottom: 16,
              width: 4,
              borderTopRightRadius: 3,
              borderBottomRightRadius: 3,
              backgroundColor: palette.volt,
            },
            barStyle,
          ]}
        />

        <SportBall sport={sport} color={out ? palette.muted : undefined} size={46} />

        <View style={{ flex: 1 }}>
          <Text
            numberOfLines={1}
            style={{
              fontFamily: 'Unbounded_800ExtraBold',
              fontSize: 21,
              lineHeight: 24,
              textTransform: 'uppercase',
              color: out ? palette.muted : palette.fg,
            }}
          >
            {SPORT_LABELS[sport]}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}>
            <View
              style={{
                width: 6,
                height: 6,
                borderRadius: 3,
                backgroundColor: out ? palette.muted : palette.volt,
              }}
            />
            <Text
              style={{
                fontFamily: 'JetBrainsMono_500Medium',
                fontSize: 12,
                letterSpacing: 0.5,
                color: out ? palette.muted : palette.volt,
              }}
            >
              {out ? 'tükendi' : 'müsait'}
            </Text>
          </View>
        </View>

        {/* right: volt check when selected, thin accent line when available */}
        {selected ? (
          <Animated.View
            style={[
              {
                width: 30,
                height: 30,
                borderRadius: 15,
                backgroundColor: palette.volt,
                alignItems: 'center',
                justifyContent: 'center',
              },
              checkStyle,
            ]}
          >
            <Feather name="check" size={18} color={palette.voltInk} />
          </Animated.View>
        ) : !out ? (
          <View style={{ width: 3, height: 34, borderRadius: 2, backgroundColor: palette.border }} />
        ) : null}
      </Animated.View>
    </Pressable>
  );
}
