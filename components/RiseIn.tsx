import { useCallback } from 'react';
import { useFocusEffect } from 'expo-router';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';

import { useReduceMotion } from '@/hooks/useReduceMotion';

type Props = {
  delay?: number;
  duration?: number;
  distance?: number;
  children: React.ReactNode;
  style?: any;
};

/**
 * Slides children up by `distance`px while fading them in.
 * Default: 12px slide, 380ms duration, 0ms delay, ease-out cubic.
 * Use staggered delays (0, 80, 140) for sequential entrance of multiple blocks.
 */
export function RiseIn({ delay = 0, duration = 380, distance = 12, children, style }: Props) {
  const v = useSharedValue(0);
  const reduceMotion = useReduceMotion();

  // ON FOCUS, not on mount. A tab screen mounts once and then stays mounted
  // forever, so a mount-only entrance played on the FIRST visit to profil and
  // never again — which is exactly the "it stops animating after a while"
  // symptom. Re-running on focus replays the entrance every time you arrive,
  // and costs nothing on screens that mount and unmount (push/pop), where focus
  // and mount coincide.
  useFocusEffect(
    useCallback(() => {
      if (reduceMotion) {
        // No slide/fade — land directly on the final state (opacity 1, no offset).
        v.value = 1;
        return;
      }
      // Rewind first: on a re-focus the value is still 1 from last time, and
      // withTiming(1) from 1 is a no-op that would silently skip the entrance.
      v.value = 0;
      v.value = withDelay(
        delay,
        withTiming(1, { duration, easing: Easing.out(Easing.cubic) })
      );
    }, [delay, duration, v, reduceMotion]),
  );

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: v.value,
    transform: [{ translateY: (1 - v.value) * distance }],
  }));

  return <Animated.View style={[style, animatedStyle]}>{children}</Animated.View>;
}
