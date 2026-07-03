import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { safeStorage } from '@/lib/safeStorage';
import type { Sport } from '@/data/stations.seed';
import {
  startSessionActivity,
  updateSessionActivity,
  endSessionActivity,
} from '@/lib/liveActivity';

export type ActiveSession = {
  stationId: string;
  stationName: string;
  sport: Sport;
  startedAt: number; // Date.now() ms
  durationMinutes: number; // planned duration
  holdId?: string | null; // Iyzico preauth paymentId, when a card hold was placed at start
  /**
   * 1-indexed compartment number this session was unlocked from. Persisted so
   * the return flow can address the same gate, and so the UI can show "K2"
   * etc. without re-deriving from sport order.
   */
  gate?: number;
  /**
   * BLE session_id the phone signed for `unlock` and the firmware now holds in
   * `activeSessionId[gate-1]`. The return_unlock command MUST replay this
   * exact value or the firmware will silently ignore it. Persisted across
   * cold-launch via zustand persist so a phone restart doesn't lose the
   * ability to close a session.
   */
  bleSessionId?: string;
  /**
   * True once the firmware has acknowledged the door was closed (the
   * `gate_closed` event arrived after a `return_unlock`). Drives the UI past
   * "kapıyı kapat" into "seans tamamlandı". Defaults to false / undefined
   * before any event arrives.
   */
  returnConfirmed?: boolean;
  /**
   * Set to Date.now() when the phone successfully writes `return_unlock` and
   * begins awaiting `gate_closed`. Persisted so that the cold-launch reattach
   * re-subscribes ONLY for sessions that actually have an inbound event to
   * catch. A plain active rental must NOT reattach — doing so spins the BLE
   * radio indefinitely and wedges proximity until a reinstall.
   */
  returnInitiatedAt?: number;
  /**
   * Firmware reported the initial UNLOCKED state expired without the user
   * grabbing the gear (no door-closed reed transition within
   * UNLOCKED_TIMEOUT_MS). Implies the session should be cancelled and the
   * payment hold released. Surfaced as a "kapıyı kapatmadın" banner.
   */
  unlockTimedOut?: boolean;
  /**
   * Firmware reported the return UNLOCKED state expired without the user
   * closing the door (no reed transition within RETURN_UNLOCKED_TIMEOUT_MS).
   * Door is still mechanically open; firmware reverted to IN_USE. UI should
   * prompt user to push the door shut or try again.
   */
  returnTimedOut?: boolean;
  /**
   * Firmware reported the planned duration was exceeded. App already shows
   * overtime from its own timer, this is a redundant signal that confirms
   * the firmware agrees on time-exceeded — useful for diagnostics and
   * future server-side overdue penalties.
   */
  overdue?: boolean;
  /**
   * Firmware emitted a `boot` event after the session started — almost
   * certainly means the station rebooted (battery dropout, watchdog kick).
   * The app should not silently continue; surface this so the user knows
   * to check that the door is still locked and equipment is accounted for.
   */
  stationRebooted?: boolean;
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
  /**
   * Mark the firmware-confirmed return on the active session. Set by the
   * BLE event listener when a `gate_closed` notification arrives for the
   * matching session_id. Idempotent.
   */
  markReturnConfirmed: () => void;
  /**
   * Stamp the active session as "return in progress" (return_unlock written,
   * awaiting gate_closed). Called by the BLE return path. Idempotent. This is
   * the signal the cold-launch reattach uses to decide whether re-subscribing
   * is worthwhile — see shouldReattach.
   */
  markReturnInitiated: () => void;
  /**
   * Apply a firmware event flag to the active session. Called by the BLE
   * event dispatcher. No-op if there's no active session or the flag is
   * already set (events can arrive duplicated when multiple subscribers
   * are attached to the same characteristic).
   */
  markFirmwareEvent: (
    kind: 'unlock_timeout' | 'return_timeout' | 'ball_overdue' | 'station_reboot'
  ) => void;
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

        const active: ActiveSession = {
          stationId: s.stationId,
          stationName: s.stationName,
          sport: s.sport,
          durationMinutes: s.durationMinutes,
          startedAt: s.startedAt ?? Date.now(),
          holdId: s.holdId ?? null,
          gate: s.gate,
          bleSessionId: s.bleSessionId,
          returnConfirmed: false,
        };
        set({ active });
        // Surface the session on the Lock Screen / Dynamic Island + home widget.
        // Best-effort and iOS-only; must never break the session flow.
        try {
          startSessionActivity(active);
        } catch {
          // no-op
        }
        return { ok: true };
      },
      endSession: () => {
        const cur = get().active;
        if (!cur) return;
        set({
          active: null,
          lastEnded: { ...cur, endedAt: Date.now() },
        });
        // Tear down the Live Activity + flip the home widget to its idle prompt.
        try {
          endSessionActivity();
        } catch {
          // no-op
        }
      },
      acknowledgeEnded: () => set({ lastEnded: null }),
      markReturnConfirmed: () => {
        const cur = get().active;
        if (!cur || cur.returnConfirmed) return;
        set({ active: { ...cur, returnConfirmed: true } });
      },
      markReturnInitiated: () => {
        const cur = get().active;
        if (!cur || cur.returnInitiatedAt) return;
        set({ active: { ...cur, returnInitiatedAt: Date.now() } });
      },
      markFirmwareEvent: (kind) => {
        const cur = get().active;
        if (!cur) return;
        const next = { ...cur };
        if (kind === 'unlock_timeout') {
          if (cur.unlockTimedOut) return;
          next.unlockTimedOut = true;
        } else if (kind === 'return_timeout') {
          if (cur.returnTimedOut) return;
          next.returnTimedOut = true;
        } else if (kind === 'ball_overdue') {
          if (cur.overdue) return;
          next.overdue = true;
        } else if (kind === 'station_reboot') {
          if (cur.stationRebooted) return;
          next.stationRebooted = true;
        }
        set({ active: next });
        // The overrun flag flipping to true is the one firmware event that
        // changes the Live Activity's appearance (coral "GEÇ" styling). Push a
        // fresh snapshot so the Lock Screen / widget swap from KALDI -> GEÇ.
        if (kind === 'ball_overdue') {
          try {
            updateSessionActivity(next);
          } catch {
            // no-op
          }
        }
      },
    }),
    {
      name: 'playbox.session',
      storage: safeStorage,
    }
  )
);
