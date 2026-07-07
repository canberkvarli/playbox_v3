import { supabase } from '@/lib/supabase';
import { useDevStore } from '@/stores/devStore';
import type { ActiveSession } from '@/stores/sessionStore';

/**
 * Records a COMPLETED real play session into `public.play_sessions` so the
 * profile can show real games / minutes / streak / city rank.
 *
 * BEST-EFFORT: fully wrapped in try/catch and never throws — a stats write
 * failure must never break the session-end flow. The `user_id` column defaults
 * to `auth.uid()` in the DB and RLS enforces it, so we don't send it here.
 *
 * NO-OP in demo/review mode: reviewers (demoMode) use DEV-* stations and must
 * never leave real play rows behind — they always see a clean first-time
 * profile. Call this from the finalize-return path, once per completed session.
 */
export async function recordPlaySession(
  active: ActiveSession,
  endedAt: number = Date.now()
): Promise<void> {
  try {
    if (useDevStore.getState().demoMode) return;

    const elapsedMs = Math.max(0, endedAt - active.startedAt);
    // Round elapsed UP to whole minutes (a 30s game still counts as 1 minute
    // of play; a fully-instant/aborted session with 0 elapsed stays 0).
    const durationMinutes = Math.ceil(elapsedMs / 60_000);

    await supabase.from('play_sessions').insert({
      station_id: active.stationId,
      sport: active.sport,
      duration_minutes: durationMinutes,
      started_at: new Date(active.startedAt).toISOString(),
      ended_at: new Date(endedAt).toISOString(),
    });
  } catch (e) {
    if (__DEV__) console.warn('[playbox] recordPlaySession failed', e);
  }
}
