import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { safeStorage } from '@/lib/safeStorage';
import type { Sport } from '@/data/stations.seed';

export type Reservation = {
  id: string;
  stationId: string;
  stationName: string;
  sport: Sport;
  createdAt: number;
  expiresAt: number;
  lockMinutes: number;
  status: 'active' | 'expired' | 'used' | 'cancelled';
};

const COOLDOWN_MIN = 30; // can't re-reserve same station for 30 min
export const RESERVATION_LOCK_MIN = 30;

type ReservationStore = {
  reservations: Reservation[];
  reserve: (input: {
    stationId: string;
    stationName: string;
    sport: Sport;
    lockMinutes?: number;
  }) => Reservation | { error: 'has_active' | 'on_cooldown' };
  cancel: (id: string) => void;
  markUsed: (id: string) => void;
  /** Returns the active (non-expired) reservation, if any. */
  getActive: () => Reservation | null;
  /** Cooldown remaining for a station in seconds, 0 if none. */
  cooldownSecondsForStation: (stationId: string) => number;
};

const isActive = (r: Reservation) =>
  r.status === 'active' && r.expiresAt > Date.now();

export const useReservationStore = create<ReservationStore>()(
  persist(
    (set, get) => ({
      reservations: [],
      reserve: ({ stationId, stationName, sport, lockMinutes = RESERVATION_LOCK_MIN }) => {
        const all = get().reservations;
        const active = all.find(isActive);
        if (active) return { error: 'has_active' };

        const now = Date.now();
        const cooldownMs = COOLDOWN_MIN * 60_000;
        const recentForStation = all.find(
          (r) => r.stationId === stationId && now - r.createdAt < cooldownMs
        );
        if (recentForStation) return { error: 'on_cooldown' };

        const reservation: Reservation = {
          id: `r_${now.toString(36)}`,
          stationId,
          stationName,
          sport,
          createdAt: now,
          expiresAt: now + lockMinutes * 60_000,
          lockMinutes,
          status: 'active',
        };
        set({ reservations: [...all, reservation] });
        return reservation;
      },
      cancel: (id) =>
        set((s) => ({
          reservations: s.reservations.map((r) =>
            r.id === id && r.status === 'active' ? { ...r, status: 'cancelled' } : r
          ),
        })),
      markUsed: (id) =>
        set((s) => ({
          reservations: s.reservations.map((r) =>
            r.id === id && r.status === 'active' ? { ...r, status: 'used' } : r
          ),
        })),
      getActive: () => get().reservations.find(isActive) ?? null,
      cooldownSecondsForStation: (stationId) => {
        const now = Date.now();
        const cooldownMs = COOLDOWN_MIN * 60_000;
        const recent = get().reservations.find(
          (r) => r.stationId === stationId && now - r.createdAt < cooldownMs
        );
        if (!recent) return 0;
        return Math.max(0, Math.ceil((cooldownMs - (now - recent.createdAt)) / 1000));
      },
    }),
    {
      name: 'playbox.reservations',
      storage: safeStorage,
    }
  )
);
