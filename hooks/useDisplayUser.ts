import { parsePhoneNumberFromString } from 'libphonenumber-js';

import { useAuthSession } from './useAuthSession';
import { useSettingsStore } from '@/stores/settingsStore';

export type DisplayUser = {
  displayName: string;
  username: string;
  phone: string;
  initial: string;
};

// Supabase strips the leading `+` from `user.phone` ("905551234567"). Fall
// back to user_metadata.phone — we mirror it there at OTP-verify time
// because the top-level phone field is occasionally blank after the
// session round-trip. Returns a pretty +90 555 123 45 67 form when valid.
function prettyPhone(raw: string | null | undefined, metaPhone: string | null | undefined): string {
  const candidate = (typeof raw === 'string' && raw.trim()) || (typeof metaPhone === 'string' && metaPhone.trim()) || '';
  if (!candidate) return '—';
  const e164 = candidate.startsWith('+') ? candidate : `+${candidate}`;
  const parsed = parsePhoneNumberFromString(e164);
  return parsed?.formatInternational() ?? e164;
}

/**
 * Single source of truth for how the user is labeled across the app.
 *
 * Resolution order:
 *   1. Settings-store overrides (update immediately on edit; survive dev bypass)
 *   2. Supabase user_metadata (name, username) + user.phone
 *   3. Hardcoded fallbacks (dev-friendly defaults)
 */
// Return v if it's a non-empty trimmed string, else undefined. `??` alone would
// accept an empty string as "defined", which lets a blank Settings override
// win over a real name/username and render an empty header.
function nonEmpty(v: string | null | undefined): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t.length > 0 ? t : undefined;
}

export function useDisplayUser(): DisplayUser {
  const { user } = useAuthSession();
  const nameOverride = useSettingsStore((s) => s.nameOverride);
  const usernameOverride = useSettingsStore((s) => s.usernameOverride);

  const meta = (user?.user_metadata ?? {}) as { name?: string; username?: string; phone?: string };
  const metaName = nonEmpty(meta.name);
  const metaUsername = nonEmpty(meta.username);

  const displayName =
    nonEmpty(nameOverride) ??
    metaName ??
    'Oyuncu';
  const username =
    nonEmpty(usernameOverride) ??
    metaUsername ??
    (user ? `oyuncu_${user.id.slice(-6)}` : 'oyuncu');

  return {
    displayName,
    username,
    phone: prettyPhone(user?.phone, meta.phone),
    initial: (displayName.charAt(0) || 'O').toUpperCase(),
  };
}
