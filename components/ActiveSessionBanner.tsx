import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useRouter, useSegments } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  Easing,
  cancelAnimation,
  interpolateColor,
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
  const abs = Math.abs(sec);
  const sign = sec < 0 ? '-' : '';
  // Under an hour: precise MM:SS clock (what you want while counting down).
  // Over an hour (only happens deep into overrun): drop seconds, switch to
  // Hsa Mdk — avoids the "-276:45" horror when a user forgets for ages.
  if (abs < 3600) {
    const mm = Math.floor(abs / 60).toString().padStart(2, '0');
    const ss = (abs % 60).toString().padStart(2, '0');
    return `${sign}${mm}:${ss}`;
  }
  const h = Math.floor(abs / 3600);
  const m = Math.floor((abs % 3600) / 60);
  return `${sign}${h}sa ${m}dk`;
}

// Reading speed for the ticker: ~60 pixels per second. News-ticker-ish,
// fast enough not to feel sluggish, slow enough to actually read.
const TICKER_PPS = 60;

/**
 * Scrolling news-ticker bar. The width is measured exactly once on the first
 * layout; after that the animation just runs forever in a `withRepeat` loop.
 * This avoids the previous stagger where every countdown tick re-ran the
 * effect and restarted the marquee.
 *
 * The two Text copies share the same animated X, so the end of the first
 * copy butts seamlessly against the start of the second — no visible gap or
 * jump at the loop boundary.
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
  const [textWidth, setTextWidth] = useState(0);
  const x = useSharedValue(0);
  const measuredRef = useRef(false);
  const runningRef = useRef(false);

  // Measure exactly once. MM:SS ticks cause the Text to re-render each
  // second, but the character count is constant (padStart), so width won't
  // meaningfully drift — safe to lock in the first measurement.
  const onTextLayout = (e: { nativeEvent: { layout: { width: number } } }) => {
    if (measuredRef.current) return;
    const w = e.nativeEvent.layout.width;
    if (w > 0) {
      measuredRef.current = true;
      setTextWidth(w);
    }
  };

  useEffect(() => {
    if (textWidth <= 0 || runningRef.current) return;
    runningRef.current = true;
    x.value = 0;
    x.value = withRepeat(
      withTiming(-textWidth, {
        duration: (textWidth / TICKER_PPS) * 1000,
        easing: Easing.linear,
      }),
      -1,
      false
    );
    return () => {
      cancelAnimation(x);
      runningRef.current = false;
    };
  }, [textWidth, x]);

  const style = useAnimatedStyle(() => ({
    flexDirection: 'row',
    transform: [{ translateX: x.value }],
  }));

  // Alert pulse — only runs while overrun. Drives a 0↔1 shared value that
  // interpolates the bar between coral and a brighter "danger red" so it
  // reads as an alarm without feeling visually noisy when on-time.
  const pulse = useSharedValue(0);
  useEffect(() => {
    if (!overrun) {
      cancelAnimation(pulse);
      pulse.value = 0;
      return;
    }
    pulse.value = 0;
    pulse.value = withRepeat(
      withTiming(1, { duration: 550, easing: Easing.inOut(Easing.ease) }),
      -1,
      true
    );
    return () => {
      cancelAnimation(pulse);
    };
  }, [overrun, pulse]);

  const fg = palette.paper;

  const barStyle = useAnimatedStyle(() => {
    const bg = overrun
      ? interpolateColor(pulse.value, [0, 1], [palette.coral, '#ff2d2d'])
      : palette.mauve;
    return {
      backgroundColor: bg,
      borderTopWidth: 1,
      borderBottomWidth: 1,
      borderColor: fg + '44',
    };
  });

  const textStyle = {
    fontFamily: 'JetBrainsMono_700Bold' as const,
    fontSize: 17,
    lineHeight: 20,
    color: fg,
    letterSpacing: 1.2,
    paddingHorizontal: 22,
  };

  return (
    <Animated.View style={barStyle}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={label}
        // Fixed height + overflow:hidden reserves vertical space and clips the
        // absolutely-positioned marquee row. Height = lineHeight (20) + vertical
        // padding (12) = 32.
        style={{ height: 32, width: '100%', overflow: 'hidden' }}
      >
        <Animated.View
          style={[
            {
              position: 'absolute',
              top: 6,
              left: 0,
              flexDirection: 'row',
              // Absolute positioning detaches the row from the parent's width
              // constraint, so Text children render at their natural width and
              // the marquee scrolls instead of wrapping.
            },
            style,
          ]}
        >
          <Text onLayout={onTextLayout} numberOfLines={1} style={textStyle}>
            {label}
          </Text>
          <Text numberOfLines={1} style={textStyle}>
            {label}
          </Text>
        </Animated.View>
      </Pressable>
    </Animated.View>
  );
}

/**
 * Active-session indicator. Renders a news-ticker style bar at both the top
 * and bottom of the screen while a session is running. Tapping either opens
 * the play tab. Hidden while already on play.
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

  const sportLabel = (SPORT_LABELS[active.sport] ?? active.sport).toUpperCase();
  const sportEmoji = SPORT_EMOJI[active.sport] ?? '';

  // Tight ticker: sport, station, countdown. Trailing spaces give the loop
  // breathing room so the text restart doesn't butt up against the previous one.
  const label =
    [
      `${sportEmoji} ${sportLabel}`,
      active.stationName.toUpperCase(),
      fmt(remaining),
    ].join('  ·  ') + '          ';

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
