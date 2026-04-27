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

import { hx } from '@/lib/haptics';
import { palette } from '@/constants/theme';
import { SPORT_LABELS } from '@/data/stations.seed';
import { SPORT_EMOJI } from '@/data/sports';
import { useSessionStore } from '@/stores/sessionStore';

function fmt(sec: number) {
  const abs = Math.abs(sec);
  const sign = sec < 0 ? '-' : '';
  if (abs < 3600) {
    const mm = Math.floor(abs / 60).toString().padStart(2, '0');
    const ss = (abs % 60).toString().padStart(2, '0');
    return `${sign}${mm}:${ss}`;
  }
  const h = Math.floor(abs / 3600);
  const m = Math.floor((abs % 3600) / 60);
  return `${sign}${h}sa ${m}dk`;
}

// Reading speed for the ticker: ~50 pixels per second.
const TICKER_PPS = 50;

/**
 * Active-session banner. Scrolling marquee at the bottom of the screen,
 * tappable to jump to /play. Coloured ink while on-time, pulsing coral when
 * overrun. Hidden on /play and on the modal-style routes that already have
 * their own primary CTAs.
 */
export function ActiveSessionBanner() {
  const active = useSessionStore((s) => s.active);
  const segments = useSegments();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [, setTick] = useState(0);

  // Marquee scroll
  const x = useSharedValue(0);
  const [textWidth, setTextWidth] = useState(0);
  const measuredRef = useRef(false);
  const runningRef = useRef(false);

  // Overrun colour pulse
  const pulse = useSharedValue(0);

  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [active]);

  const elapsedSec = active ? Math.floor((Date.now() - active.startedAt) / 1000) : 0;
  const totalSec = active ? active.durationMinutes * 60 : 0;
  const remaining = totalSec - elapsedSec;
  const overrun = remaining < 0;

  useEffect(() => {
    if (!active || !overrun) {
      cancelAnimation(pulse);
      pulse.value = 0;
      return;
    }
    pulse.value = 0;
    pulse.value = withRepeat(
      withTiming(1, { duration: 600, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
    return () => {
      cancelAnimation(pulse);
    };
  }, [active, overrun, pulse]);

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
      false,
    );
    return () => {
      cancelAnimation(x);
      runningRef.current = false;
    };
  }, [textWidth, x]);

  const cardStyle = useAnimatedStyle(() => {
    const bg = overrun
      ? interpolateColor(pulse.value, [0, 1], [palette.coral, '#ff3a3a'])
      : palette.ink;
    return { backgroundColor: bg };
  });

  const marqueeStyle = useAnimatedStyle(() => ({
    flexDirection: 'row',
    transform: [{ translateX: x.value }],
  }));

  if (!active) return null;
  const path = segments.join('/');
  if (path.endsWith('(tabs)/play')) return null;
  if (path.includes('session-prep') || path.includes('session-review')) return null;
  if (path.includes('card-add') || path.includes('scan')) return null;

  const sportLabel = (SPORT_LABELS[active.sport] ?? active.sport).toUpperCase();
  const sportEmoji = SPORT_EMOJI[active.sport] ?? '';

  // Repeated label with separators. Two trailing spaces give the loop seam
  // some air so the restart doesn't feel jarring.
  const label =
    [
      `${sportEmoji}  ${sportLabel}`,
      active.stationName.toUpperCase(),
      `${overrun ? 'GEÇ' : 'KALDI'} ${fmt(remaining)}`,
      'OYNA SEKMESİNE GİT',
    ].join('   ·   ') + '         ';

  const onTextLayout = (e: { nativeEvent: { layout: { width: number } } }) => {
    if (measuredRef.current) return;
    const w = e.nativeEvent.layout.width;
    if (w > 0) {
      measuredRef.current = true;
      setTextWidth(w);
    }
  };

  const onPress = async () => {
    await hx.tap();
    router.push('/(tabs)/play');
  };

  const textStyle = {
    fontFamily: 'JetBrainsMono_700Bold' as const,
    fontSize: 14,
    lineHeight: 18,
    color: palette.paper,
    letterSpacing: 1.2,
    paddingHorizontal: 18,
  };

  return (
    <View
      pointerEvents="box-none"
      style={{
        position: 'absolute',
        bottom: insets.bottom + 10,
        left: 12,
        right: 12,
        zIndex: 50,
        elevation: 50,
      }}
    >
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`aktif seans: ${active.stationName}, ${fmt(remaining)} ${overrun ? 'gecikme' : 'kaldı'}`}
        style={({ pressed }) => ({ opacity: pressed ? 0.92 : 1 })}
      >
        <Animated.View
          style={[
            {
              borderRadius: 18,
              borderWidth: 1.5,
              borderColor: palette.paper + '22',
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 8 },
              shadowOpacity: 0.22,
              shadowRadius: 14,
              elevation: 10,
              overflow: 'hidden',
              height: 44,
              flexDirection: 'row',
              alignItems: 'center',
            },
            cardStyle,
          ]}
        >
          {/* Status dot — pulses with the colour, sits flush left so users
              know exactly where the ticker starts. */}
          <View
            style={{
              width: 8,
              height: 8,
              borderRadius: 4,
              backgroundColor: overrun ? palette.paper : palette.butter,
              marginLeft: 14,
              marginRight: 6,
            }}
          />

          {/* Marquee viewport — overflow:hidden clips the row of duplicated
              Texts. Two copies share the same animated translateX so the seam
              is invisible. */}
          <View style={{ flex: 1, height: 44, overflow: 'hidden', justifyContent: 'center' }}>
            <Animated.View
              style={[
                {
                  position: 'absolute',
                  left: 0,
                  flexDirection: 'row',
                  alignItems: 'center',
                },
                marqueeStyle,
              ]}
            >
              <Text onLayout={onTextLayout} numberOfLines={1} style={textStyle}>
                {label}
              </Text>
              <Text numberOfLines={1} style={textStyle}>
                {label}
              </Text>
            </Animated.View>
          </View>
        </Animated.View>
      </Pressable>
    </View>
  );
}
