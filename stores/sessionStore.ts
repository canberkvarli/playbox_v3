import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { safeStorage } from '@/lib/safeStorage';
import type { Sport } from '@/data/stations.seed';

export type ActiveSession = {
  stationId: string;
  stationName: string;
  sport: Sport;
  startedAt: number; // Date.now() ms
  durationMinutes: number; // planned duration
  holdId?: string | null; // Iyzico preauth paymentId, when a card hold was placed at start
};

export type EndedSession = ActiveSession & { endedAt: number };

export type SessionBlockReason =
  /** A session is already active at this exact station — go to /play. */
  | 'same_station_active'
  /** A session is active at a different station — end that first. */
  | 'other_station_active';

export type StartResult =
  | { ok: true }
  | { ok: false; reason: SessionBlockReason; active: ActiveSession };

type SessionStore = {
  active: ActiveSession | null;
  /** Last-ended session, kept until review screen acknowledges it. */
  lastEnded: EndedSession | null;
  /**
   * Starts a session. Refuses if one is already active anywhere — callers must
   * pre-check with `canStart` and show the appropriate UI. Also auto-consumes
   * any matching active reservation so the list stays clean.
   */
  startSession: (
    s: Omit<ActiveSession, 'startedAt'> & { startedAt?: number }
  ) => StartResult;
  /** Closes the active session, stashing it as `lastEnded` for the review page. */
  endSession: () => void;
  /** Called by the review page when the user dismisses; clears `lastEnded`. */
  acknowledgeEnded: () => void;
  /** Pre-flight check: can the user start a session at this station right now? */
  canStart: (stationId: string) => StartResult;
  hasActive: () => boolean;
};

export const useSessionStore = create<SessionStore>()(
  persist(
    (set, get) => ({
      active: null,
      lastEnded: null,
      canStart: (stationId) => {
        const active = get().active;
        if (!active) return { ok: true };
        return {
          ok: false,
          reason: active.stationId === stationId
            ? 'same_station_active'
            : 'other_station_active',
          active,
        };
      },
      hasActive: () => get().active !== null,
      startSession: (s) => {
        const check = get().canStart(s.stationId);
        if (!check.ok) return check;

        // Reservation consumption now happens server-side via the
        // /reservation-consume Edge Function, triggered from the QR scan
        // flow (app/scan.tsx). The legacy in-memory markUsed() path was
        // removed when the reservation system became server-authoritative.

        set({
          active: {
            stationId: s.stationId,
            stationName: s.stationName,
            sport: s.sport,
            durationMinutes: s.durationMinutes,
            startedAt: s.startedAt ?? Date.now(),
            holdId: s.holdId ?? null,
          },
        });
        return { ok: true };
      },
      endSession: () => {
        const cur = get().active;
        if (!cur) return;
        set({
          active: null,
          lastEnded: { ...cur, endedAt: Date.now() },
        });
      },
      acknowledgeEnded: () => set({ lastEnded: null }),
    }),
    {
      name: 'playbox.session',
      storage: safeStorage,
    }
  )
);
