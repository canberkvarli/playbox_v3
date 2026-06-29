import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * Tracks the OS "Reduce Motion" accessibility setting, live.
 *
 * Animations (entrance slides, shimmer/pulse loops, marquees) should read this
 * and fall back to a static end-state when it returns true, so motion-sensitive
 * users aren't subjected to continuous or large motion. Defaults to false and
 * updates if the user toggles the setting while the app is running.
 */
export function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => {
      if (mounted) setReduce(!!v);
    });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', (v) =>
      setReduce(!!v),
    );
    return () => {
      mounted = false;
      // RN >= 0.65 returns a subscription with remove(); tolerate both shapes.
      // @ts-ignore — older RN returned void from addEventListener
      sub?.remove?.();
    };
  }, []);

  return reduce;
}
