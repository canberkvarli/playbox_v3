import { useAuthSession } from './useAuthSession';
import { useSettingsStore } from '@/stores/settingsStore';

export type DisplayUser = {
  displayName: string;
  username: string;
  phone: string;
  initial: string;
};

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

  const meta = (user?.user_metadata ?? {}) as { name?: string; username?: string };
  const metaName = nonEmpty(meta.name);
  const metaUsername = nonEmpty(meta.username);
  const phoneRaw = user?.phone;

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
    phone: phoneRaw ? `+${phoneRaw}` : '—',
    initial: (displayName.charAt(0) || 'O').toUpperCase(),
  };
}
