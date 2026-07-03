import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSegments, useRouter } from 'expo-router';
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
import { palette, darkPalette } from '@/constants/theme';
import { SPORT_LABELS } from '@/data/stations.seed';
import { SPORT_EMOJI } from '@/data/sports';
import { useSessionStore } from '@/stores/sessionStore';
import { useReduceMotion } from '@/hooks/useReduceMotion';

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

/**
 * Active-session banner. A STATIC card pinned just above the tab bar, tappable
 * to jump to /play. Dark asphalt while on-time, pulsing coral when overrun.
 * (Was a scrolling marquee — it mis-measured its width and truncated the last
 * "OYNA SEKMESİNE GİT" segment; a static row is legible and never trims.)
 * Hidden on /play and on the modal-style routes that already carry their own CTA.
 */
export function ActiveSessionBanner() {
  const active = useSessionStore((s) => s.active);
  const segments = useSegments();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const reduceMotion = useReduceMotion();
  const [, setTick] = useState(0);

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
    if (reduceMotion) {
      cancelAnimation(pulse);
      pulse.value = 1;
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
  }, [active, overrun, pulse, reduceMotion]);

  const cardStyle = useAnimatedStyle(() => {
    // Theme-STABLE colours: the banner is a dark asphalt chip in BOTH themes.
    const bg = overrun
      ? interpolateColor(pulse.value, [0, 1], [palette.coral, '#ff3a3a'])
      : darkPalette.bg;
    return { backgroundColor: bg };
  });

  if (!active) return null;
  const path = segments.join('/');
  if (path.endsWith('(tabs)/play')) return null;
  if (path.includes('session-prep') || path.includes('session-review')) return null;
  if (path.includes('card-add') || path.includes('scan')) return null;

  const sportLabel = (SPORT_LABELS[active.sport] ?? active.sport).toUpperCase();
  const sportEmoji = SPORT_EMOJI[active.sport] ?? '';
  const stationShort = active.stationName.split(' ')[0].toUpperCase();

  const onPress = async () => {
    await hx.tap();
    router.push('/(tabs)/play');
  };

  return (
    <View
      pointerEvents="box-none"
      style={{
        // Sit just ABOVE the tab bar (its designed home). Rendered after <Tabs>,
        // so it paints over the map's bottom sheet too.
        position: 'absolute',
        bottom: insets.bottom + 64,
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
              borderColor: darkPalette.fg + '22',
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 8 },
              shadowOpacity: 0.22,
              shadowRadius: 14,
              elevation: 10,
              overflow: 'hidden',
              minHeight: 48,
              flexDirection: 'row',
              alignItems: 'center',
              paddingLeft: 14,
              paddingRight: 6,
              paddingVertical: 6,
              gap: 10,
            },
            cardStyle,
          ]}
        >
          {/* Status dot — coral while on-time, white while overrun. */}
          <View
            style={{
              width: 8,
              height: 8,
              borderRadius: 4,
              backgroundColor: overrun ? '#FFFFFF' : palette.butter,
            }}
          />

          {/* Sport · station — truncates with ellipsis, never trims mid-word. */}
          <Text
            numberOfLines={1}
            style={{
              flex: 1,
              fontFamily: 'JetBrainsMono_700Bold',
              fontSize: 13,
              letterSpacing: 1,
              color: darkPalette.fg,
            }}
          >
            {`${sportEmoji}  ${sportLabel} · ${stationShort}`}
          </Text>

          {/* Countdown — mono, cream. */}
          <Text
            style={{
              fontFamily: 'JetBrainsMono_700Bold',
              fontSize: 13,
              letterSpacing: 0.5,
              color: overrun ? '#FFFFFF' : darkPalette.fg,
            }}
          >
            {`${overrun ? 'GEÇ ' : ''}${fmt(remaining)}`}
          </Text>

          {/* Explicit "OYNA ›" affordance so it clearly reads as tappable. */}
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 1,
              backgroundColor: darkPalette.volt,
              borderRadius: 999,
              paddingLeft: 12,
              paddingRight: 8,
              paddingVertical: 7,
            }}
          >
            <Text
              style={{
                fontFamily: 'JetBrainsMono_700Bold',
                fontSize: 12,
                letterSpacing: 1,
                color: darkPalette.bg,
              }}
            >
              OYNA
            </Text>
            <Feather name="chevron-right" size={15} color={darkPalette.bg} />
          </View>
        </Animated.View>
      </Pressable>
    </View>
  );
}
