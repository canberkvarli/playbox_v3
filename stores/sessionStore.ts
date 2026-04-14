import { create } from 'zustand';
import type { Sport } from '@/data/stations.seed';

export type ActiveSession = {
  stationId: string;
  stationName: string;
  sport: Sport;
  startedAt: number; // Date.now() ms
  durationMinutes: number; // planned duration
};

type SessionStore = {
  active: ActiveSession | null;
  startSession: (s: Omit<ActiveSession, 'startedAt'> & { startedAt?: number }) => void;
  endSession: () => void;
};

export const useSessionStore = create<SessionStore>((set) => ({
  active: null,
  startSession: (s) =>
    set({
      active: {
        stationId: s.stationId,
        stationName: s.stationName,
        sport: s.sport,
        durationMinutes: s.durationMinutes,
        startedAt: s.startedAt ?? Date.now(),
      },
    }),
  endSession: () => set({ active: null }),
}));
