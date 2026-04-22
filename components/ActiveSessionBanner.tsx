import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useRouter, useSegments } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { palette } from '@/constants/theme';
import { hx } from '@/lib/haptics';
import { SPORT_LABELS } from '@/data/stations.seed';
import { SPORT_EMOJI } from '@/data/sports';
import { useSessionStore } from '@/stores/sessionStore';

function fmt(sec: number) {
  const mm = Math.floor(Math.abs(sec) / 60).toString().padStart(2, '0');
  const ss = (Math.abs(sec) % 60).toString().padStart(2, '0');
  return `${sec < 0 ? '-' : ''}${mm}:${ss}`;
}

/**
 * Scrolling news-ticker bar. Measures the text once, then animates a
 * horizontal translate loop so the two duplicated copies produce a seamless
 * marquee with no jump at the wrap.
 */
function Ticker({
  label,
  onPress,
  overrun,
}: {
  label: string;
  onPress: () => void;
  overrun: boolean;
}) {
  const [w, setW] = useState(0);
  const x = useSharedValue(0);

  useEffect(() => {
    if (w <= 0) return;
    cancelAnimation(x);
    x.value = 0;
    // ~18ms per pixel → a ~400px label takes ~7s to cross. Long labels move
    // proportionally slower so reading speed stays roughly constant.
    x.value = withRepeat(
      withTiming(-w, { duration: Math.max(5000, w * 18), easing: Easing.linear }),
      -1,
      false
    );
  }, [w, x, label]);

  const style = useAnimatedStyle(() => ({
    flexDirection: 'row',
    transform: [{ translateX: x.value }],
  }));

  const bg = overrun ? palette.coral : palette.ink;
  const fg = overrun ? palette.paper : palette.butter;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={{
        backgroundColor: bg,
        overflow: 'hidden',
        paddingVertical: 10,
        borderTopWidth: 1.5,
        borderBottomWidth: 1.5,
        borderColor: fg + '55',
      }}
    >
      <Animated.View style={style}>
        <Text
          onLayout={(e) => setW(e.nativeEvent.layout.width)}
          numberOfLines={1}
          style={{
            fontFamily: 'JetBrainsMono_500Medium',
            fontSize: 13,
            color: fg,
            letterSpacing: 1.2,
            paddingHorizontal: 24,
          }}
        >
          {label}
        </Text>
        <Text
          numberOfLines={1}
          style={{
            fontFamily: 'JetBrainsMono_500Medium',
            fontSize: 13,
            color: fg,
            letterSpacing: 1.2,
            paddingHorizontal: 24,
          }}
        >
          {label}
        </Text>
      </Animated.View>
    </Pressable>
  );
}

/**
 * Active-session indicator. Renders a news-ticker style bar at both the top
 * and bottom of the screen while a session is running. Tapping either opens
 * the play tab. Hidden while already on play (avoid double UI).
 */
export function ActiveSessionBanner() {
  const active = useSessionStore((s) => s.active);
  const router = useRouter();
  const segments = useSegments();
  const insets = useSafeAreaInsets();
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [active]);

  if (!active) return null;
  if (segments.join('/').endsWith('(tabs)/play')) return null;

  const elapsedSec = Math.floor((Date.now() - active.startedAt) / 1000);
  const totalSec = active.durationMinutes * 60;
  const remaining = totalSec - elapsedSec;
  const overrun = remaining < 0;

  const sportBadge = `${SPORT_EMOJI[active.sport] ?? ''} ${
    SPORT_LABELS[active.sport] ?? active.sport
  }`.trim().toUpperCase();

  const label =
    [
      '●',
      'AKTİF SEANS',
      sportBadge,
      active.stationName,
      overrun ? `${fmt(remaining)} GECİKTİ` : `${fmt(remaining)} KALDI`,
      '●',
      'DOKUN VE AÇ',
    ].join('  ·  ') + '     ';

  const onPress = async () => {
    await hx.tap();
    router.push('/(tabs)/play');
  };

  return (
    <>
      <View
        pointerEvents="box-none"
        style={{
          position: 'absolute',
          top: insets.top,
          left: 0,
          right: 0,
          zIndex: 50,
          elevation: 50,
        }}
      >
        <Ticker label={label} onPress={onPress} overrun={overrun} />
      </View>
      <View
        pointerEvents="box-none"
        style={{
          position: 'absolute',
          bottom: insets.bottom,
          left: 0,
          right: 0,
          zIndex: 50,
          elevation: 50,
        }}
      >
        <Ticker label={label} onPress={onPress} overrun={overrun} />
      </View>
    </>
  );
}
