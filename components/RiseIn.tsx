import { useEffect } from 'react';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';

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

  useEffect(() => {
    v.value = withDelay(
      delay,
      withTiming(1, { duration, easing: Easing.out(Easing.cubic) })
    );
  }, [delay, duration, v]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: v.value,
    transform: [{ translateY: (1 - v.value) * distance }],
  }));

  return <Animated.View style={[style, animatedStyle]}>{children}</Animated.View>;
}
