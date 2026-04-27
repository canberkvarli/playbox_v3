import { Platform } from 'react-native';
import Constants from 'expo-constants';

import { supabase } from '@/lib/supabase';

export type FeedbackKind = 'session' | 'app';

export type FeedbackInput = {
  kind: FeedbackKind;
  rating: number;            // 0..4 (matches FACES index in session-review)
  reasons?: string[];        // i18n keys e.g. ['equipment', 'gate']
  message?: string;          // free text, optional
  sessionId?: string;        // only when kind='session'
};

export type FeedbackResult =
  | { ok: true }
  | { ok: false; error: string };

const APP_VERSION = (() => {
  try {
    const v = Constants.expoConfig?.version ?? Constants.manifest?.version;
    return v ? `${v}+${Platform.OS}` : Platform.OS;
  } catch {
    return Platform.OS;
  }
})();

/**
 * INSERTs a feedback row through the user's JWT — RLS owner-insert policy
 * lets the row land if user_id matches the JWT sub. No server hop required.
 */
export async function submitFeedback(input: FeedbackInput): Promise<FeedbackResult> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const userId = session?.user?.id ?? null;
  if (!userId) return { ok: false, error: 'unauthenticated' };

  const { error } = await supabase.from('feedback').insert({
    user_id: userId,
    kind: input.kind,
    session_id: input.sessionId ?? null,
    rating: input.rating,
    reasons: input.reasons && input.reasons.length > 0 ? input.reasons : null,
    message: input.message?.trim() ? input.message.trim() : null,
    app_version: APP_VERSION,
  });

  if (error) {
    if (__DEV__) console.warn('[feedback] insert failed', error);
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

/** True when the rating warrants opening the bad-feedback modal. */
export function isBadRating(rating: number | null): boolean {
  return rating != null && rating <= 1;
}

/** Quick-pick reason keys for the session-end modal. Matches i18n keys
 *  under `feedback.bad.session.reasons.*`. */
export const SESSION_REASON_KEYS = [
  'equipment',
  'gate',
  'cleanliness',
  'misleading',
  'pricing',
  'other',
] as const;

/** Quick-pick reason keys for a future standalone "rate the app" prompt.
 *  Matches `feedback.bad.app.reasons.*`. */
export const APP_REASON_KEYS = [
  'slow',
  'confusing',
  'crashed',
  'map_wrong',
  'notifications',
  'other',
] as const;
