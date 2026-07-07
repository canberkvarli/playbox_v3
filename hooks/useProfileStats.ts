import { useEffect, useState } from 'react';

import { supabase } from '@/lib/supabase';
import { useDevStore } from '@/stores/devStore';

export type ProfileStats = {
  games: number;
  totalMinutes: number;
  streakDays: number;
  cityRank: number | null;
  cityTotalPlayers: number | null;
};

export type ProfileStatsState = ProfileStats & {
  /** True while the RPC is in flight (first load). */
  loading: boolean;
};

const EMPTY: ProfileStats = {
  games: 0,
  totalMinutes: 0,
  streakDays: 0,
  cityRank: null,
  cityTotalPlayers: null,
};

/**
 * Real profile play-stats via the `get_play_stats` RPC.
 *
 * BEST-EFFORT: returns zeros/nulls while loading or on any error (missing
 * table before the migration is applied, network failure, no session) — the
 * profile then simply renders the first-time state and never crashes.
 *
 * DEMO MODE: skips the RPC entirely and reports zeros so App Store reviewers
 * always see a clean first-time profile.
 */
export function useProfileStats(): ProfileStatsState {
  const demoMode = useDevStore((s) => s.demoMode);
  const [state, setState] = useState<ProfileStatsState>({
    ...EMPTY,
    loading: !demoMode,
  });

  useEffect(() => {
    let cancelled = false;

    if (demoMode) {
      setState({ ...EMPTY, loading: false });
      return;
    }

    (async () => {
      try {
        const { data, error } = await supabase.rpc('get_play_stats');
        if (cancelled) return;
        // rpc returning a single-row table comes back as an array of one row.
        const row = Array.isArray(data) ? data[0] : data;
        if (error || !row) {
          setState({ ...EMPTY, loading: false });
          return;
        }
        setState({
          games: Number(row.games ?? 0),
          totalMinutes: Number(row.total_minutes ?? 0),
          streakDays: Number(row.streak_days ?? 0),
          cityRank: row.city_rank == null ? null : Number(row.city_rank),
          cityTotalPlayers:
            row.city_total_players == null ? null : Number(row.city_total_players),
          loading: false,
        });
      } catch {
        if (!cancelled) setState({ ...EMPTY, loading: false });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [demoMode]);

  return state;
}
