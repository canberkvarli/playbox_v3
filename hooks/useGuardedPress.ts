import { useCallback, useEffect, useRef } from 'react';

/**
 * Wraps an onPress handler so rapid double-taps can't fire it twice.
 *
 * Locks on the first invocation, runs the handler, then releases after a
 * short cooldown. Necessary because React state-based `busy` flags don't
 * commit fast enough to block a fast second tap (especially on navigation
 * handlers that finish synchronously). The ref-based latch closes
 * immediately on the first tap.
 *
 * Default cooldown is 600ms — long enough to swallow a frenzied
 * double-tap, short enough that legitimate retries still feel responsive.
 */
export function useGuardedPress<A extends unknown[]>(
  fn: (...args: A) => unknown | Promise<unknown>,
  cooldownMs = 600,
): (...args: A) => Promise<void> {
  const fnRef = useRef(fn);
  const lockedRef = useRef(false);
  useEffect(() => {
    fnRef.current = fn;
  }, [fn]);

  return useCallback(
    async (...args: A) => {
      if (lockedRef.current) return;
      lockedRef.current = true;
      try {
        await fnRef.current(...args);
      } finally {
        setTimeout(() => {
          lockedRef.current = false;
        }, cooldownMs);
      }
    },
    [cooldownMs],
  );
}
