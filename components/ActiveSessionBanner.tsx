import { useEffect, useState } from 'react';
import { Pressable, Text, View, useWindowDimensions } from 'react-native';
import { useSegments, useRouter } from 'expo-router';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { hx } from '@/lib/haptics';
import { palette, darkPalette } from '@/constants/theme';
import { SPORT_LABELS } from '@/data/stations.seed';
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

const STRIP_H = 46;
const SCROLL_PPS = 55; // marquee reading speed (px/sec)

/**
 * One diagonal "crime-scene tape" strip with infinitely scrolling text. The
 * text row is duplicated; we measure ONE copy and loop translateX by exactly
 * that width, so the repeat is seamless (never trims). Colours live in JS (the
 * worklet only animates transform) to dodge the reanimated palette-snapshot bug.
 */
function TapeStrip({
  text,
  rotateDeg,
  dir,
  bg,
  fg,
  top,
  left,
  width,
  onPress,
  reduceMotion,
}: {
  text: string;
  rotateDeg: number;
  dir: 1 | -1; // -1 scrolls left, 1 scrolls right
  bg: string;
  fg: string;
  top: number;
  left: number;
  width: number;
  onPress: () => void;
  reduceMotion: boolean;
}) {
  const x = useSharedValue(0);
  const [unit, setUnit] = useState(0);

  useEffect(() => {
    if (!unit) return;
    if (reduceMotion) {
      cancelAnimation(x);
      x.value = 0;
      return;
    }
    const from = dir < 0 ? 0 : -unit;
    const to = dir < 0 ? -unit : 0;
    x.value = from;
    x.value = withRepeat(
      withTiming(to, { duration: (unit / SCROLL_PPS) * 1000, easing: Easing.linear }),
      -1,
      false,
    );
    return () => cancelAnimation(x);
  }, [unit, reduceMotion, dir, x]);

  const rowStyle = useAnimatedStyle(() => ({
    flexDirection: 'row',
    transform: [{ translateX: x.value }],
  }));

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={{
        position: 'absolute',
        top,
        left,
        width,
        height: STRIP_H,
        transform: [{ rotate: `${rotateDeg}deg` }],
      }}
    >
      <View
        style={{
          flex: 1,
          overflow: 'hidden',
          backgroundColor: bg,
          borderTopWidth: 3,
          borderBottomWidth: 3,
          borderColor: fg,
          justifyContent: 'center',
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 6 },
          shadowOpacity: 0.35,
          shadowRadius: 12,
          elevation: 12,
        }}
      >
        <Animated.View style={rowStyle}>
          {Array.from({ length: 14 }).map((_, i) => (
            <Text
              key={i}
              onLayout={
                i === 0
                  ? (e) => {
                      const w = e.nativeEvent.layout.width;
                      if (w > 0) setUnit((u) => u || w);
                    }
                  : undefined
              }
              numberOfLines={1}
              style={{
                fontFamily: 'JetBrainsMono_700Bold',
                fontSize: 14,
                letterSpacing: 2,
                color: fg,
              }}
            >
              {text}
            </Text>
          ))}
        </Animated.View>
      </View>
    </Pressable>
  );
}

/**
 * Active-session indicator: two crime-scene tape strips crossed in an X over the
 * MAP, text scrolling in opposite directions. Volt while on-time, coral when
 * overrun. Tapping either strip jumps to /play. Map-only — the glowing play tab
 * covers the other screens. Rendered after <Tabs>, so it paints over the map.
 */
export function ActiveSessionBanner() {
  const active = useSessionStore((s) => s.active);
  const segments = useSegments();
  const router = useRouter();
  const reduceMotion = useReduceMotion();
  const { width: screenW, height: screenH } = useWindowDimensions();
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [active]);

  if (!active) return null;
  const path = segments.join('/');
  const onMap = path.endsWith('(tabs)/map') || path.endsWith('(tabs)');
  if (!onMap) return null;

  const elapsedSec = Math.floor((Date.now() - active.startedAt) / 1000);
  const remaining = active.durationMinutes * 60 - elapsedSec;
  const overrun = remaining < 0;

  const sportLabel = (SPORT_LABELS[active.sport] ?? active.sport).toUpperCase();
  const stationShort = active.stationName.split(' ')[0].toUpperCase();
  const text = `SEANS AKTİF · ${sportLabel} · ${stationShort} · ${
    overrun ? 'GEÇ ' : 'KALDI '
  }${fmt(remaining)}   ·   `;

  const bg = overrun ? palette.coral : darkPalette.volt; // hazard: coral overrun / volt live
  const fg = darkPalette.bg; // asphalt ink on the tape

  const onPress = async () => {
    await hx.tap();
    router.push('/(tabs)/play');
  };

  // Strip spans the screen diagonal so its ends reach past the corners once
  // rotated. Both cross at the same centre point → an X.
  const stripW = Math.hypot(screenW, screenH) + 80;
  const centerTop = screenH * 0.44 - STRIP_H / 2;
  const left = (screenW - stripW) / 2;

  return (
    <View
      pointerEvents="box-none"
      style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 60, elevation: 60 }}
    >
      <TapeStrip
        text={text}
        rotateDeg={20}
        dir={-1}
        bg={bg}
        fg={fg}
        top={centerTop}
        left={left}
        width={stripW}
        onPress={onPress}
        reduceMotion={reduceMotion}
      />
      <TapeStrip
        text={text}
        rotateDeg={-20}
        dir={1}
        bg={bg}
        fg={fg}
        top={centerTop}
        left={left}
        width={stripW}
        onPress={onPress}
        reduceMotion={reduceMotion}
      />
    </View>
  );
}
