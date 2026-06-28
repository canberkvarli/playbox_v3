import type { ActiveSession, EndedSession } from '@/stores/sessionStore';

/**
 * Guards + sanitizers for the persisted `playbox.session` blob.
 *
 * WHY: zustand `persist` rehydrates whatever is on disk verbatim. After an OTA
 * that changes the `ActiveSession` shape — or any partial/corrupt write — a
 * drifted blob would rehydrate into the store and could wedge the app (a phantom
 * "active" session you can't act on), which historically only a reinstall fixed.
 *
 * These sanitizers drop `active`/`lastEnded` ONLY when the SHAPE is invalid
 * (missing/again-wrong-typed required fields) — data that's already unusable, so
 * dropping it can't lose anything actionable. They intentionally DO NOT drop a
 * session by age: a stale `active` may still carry an unreleased payment hold,
 * and silently nulling it would orphan money. Age-based settlement belongs to
 * the server-side payment work, not here.
 */

export const SESSION_PERSIST_VERSION = 1;

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

function isFinitePositive(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0;
}

/**
 * Validate + normalize a raw persisted `active` value. Returns a clean
 * ActiveSession or null if the core shape is unusable. Malformed OPTIONAL fields
 * are dropped individually rather than failing the whole session.
 */
export function sanitizeActiveSession(raw: unknown): ActiveSession | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;

  if (!isNonEmptyString(o.stationId)) return null;
  if (!isNonEmptyString(o.stationName)) return null;
  if (!isNonEmptyString(o.sport)) return null;
  if (!isFinitePositive(o.startedAt)) return null;
  if (!isFinitePositive(o.durationMinutes)) return null;

  const out: ActiveSession = {
    stationId: o.stationId,
    stationName: o.stationName,
    sport: o.sport as ActiveSession['sport'],
    startedAt: o.startedAt,
    durationMinutes: o.durationMinutes,
  };

  // Optional fields — carried over only when well-typed.
  if (typeof o.holdId === 'string' || o.holdId === null) {
    out.holdId = o.holdId as string | null;
  }
  if (isFinitePositive(o.gate)) out.gate = o.gate;
  if (isNonEmptyString(o.bleSessionId)) out.bleSessionId = o.bleSessionId;
  if (typeof o.returnConfirmed === 'boolean') out.returnConfirmed = o.returnConfirmed;
  if (isFinitePositive(o.returnInitiatedAt)) out.returnInitiatedAt = o.returnInitiatedAt;
  if (typeof o.unlockTimedOut === 'boolean') out.unlockTimedOut = o.unlockTimedOut;
  if (typeof o.returnTimedOut === 'boolean') out.returnTimedOut = o.returnTimedOut;
  if (typeof o.overdue === 'boolean') out.overdue = o.overdue;
  if (typeof o.stationRebooted === 'boolean') out.stationRebooted = o.stationRebooted;

  return out;
}

/** Same as sanitizeActiveSession, but also requires a valid `endedAt`. */
export function sanitizeEndedSession(raw: unknown): EndedSession | null {
  const base = sanitizeActiveSession(raw);
  if (!base) return null;
  const o = raw as Record<string, unknown>;
  if (!isFinitePositive(o.endedAt)) return null;
  return { ...base, endedAt: o.endedAt };
}

export type PersistedSessionShape = {
  active: ActiveSession | null;
  lastEnded: EndedSession | null;
};

/**
 * Sanitize a whole persisted session blob from any prior version. Always
 * returns a well-formed shape; anything invalid becomes null.
 */
export function migratePersistedSession(state: unknown): PersistedSessionShape {
  if (!state || typeof state !== 'object') {
    return { active: null, lastEnded: null };
  }
  const o = state as Record<string, unknown>;
  return {
    active: sanitizeActiveSession(o.active),
    lastEnded: sanitizeEndedSession(o.lastEnded),
  };
}
