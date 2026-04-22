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

type SessionStore = {
  active: ActiveSession | null;
  /** Last-ended session, kept until review screen acknowledges it. */
  lastEnded: EndedSession | null;
  startSession: (s: Omit<ActiveSession, 'startedAt'> & { startedAt?: number }) => void;
  /** Closes the active session, stashing it as `lastEnded` for the review page. */
  endSession: () => void;
  /** Called by the review page when the user dismisses; clears `lastEnded`. */
  acknowledgeEnded: () => void;
};

export const useSessionStore = create<SessionStore>()(
  persist(
    (set, get) => ({
      active: null,
      lastEnded: null,
      startSession: (s) =>
        set({
          active: {
            stationId: s.stationId,
            stationName: s.stationName,
            sport: s.sport,
            durationMinutes: s.durationMinutes,
            startedAt: s.startedAt ?? Date.now(),
            holdId: s.holdId ?? null,
          },
        }),
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
