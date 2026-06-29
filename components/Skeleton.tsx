import { useEffect } from 'react';
import { View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { palette } from '@/constants/theme';
import { useReduceMotion } from '@/hooks/useReduceMotion';

/**
 * Pulsing rectangle used while async data is loading. Honest UX: replace
 * `null` first-paint with a shape that hints at what will land there, so
 * the page doesn't visually jump when content arrives.
 */
export function Skeleton({
  width,
  height,
  radius = 12,
  style,
}: {
  width: number | `${number}%`;
  height: number;
  radius?: number;
  style?: object;
}) {
  const v = useSharedValue(0);
  const reduceMotion = useReduceMotion();
  useEffect(() => {
    if (reduceMotion) {
      // Static dimmed block — no infinite shimmer for motion-sensitive users.
      v.value = 0.7;
      return;
    }
    v.value = withRepeat(
      withTiming(1, { duration: 900, easing: Easing.inOut(Easing.quad) }),
      -1,
      true,
    );
  }, [v, reduceMotion]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: 0.5 + v.value * 0.4,
  }));

  return (
    <Animated.View
      style={[
        {
          width,
          height,
          borderRadius: radius,
          backgroundColor: palette.ink + '14',
        },
        animatedStyle,
        style,
      ]}
    />
  );
}
