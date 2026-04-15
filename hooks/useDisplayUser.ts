import { useUser } from '@clerk/clerk-expo';
import { useSettingsStore } from '@/stores/settingsStore';

export type DisplayUser = {
  displayName: string;
  username: string;
  phone: string;
  initial: string;
};

/**
 * Single source of truth for how the user is labeled across the app.
 * Both Profile and Settings read from here so they never drift.
 *
 * Resolution order:
 *   1. Settings store overrides (survive dev bypass; update immediately on edit)
 *   2. Clerk user fields
 *   3. Hardcoded fallbacks (dev-friendly defaults)
 */
export function useDisplayUser(): DisplayUser {
  const { user, isLoaded } = useUser();
  const nameOverride = useSettingsStore((s) => s.nameOverride);
  const usernameOverride = useSettingsStore((s) => s.usernameOverride);

  const clerkName = isLoaded && user ? user.firstName?.trim() : undefined;
  const clerkUsername = isLoaded && user ? user.username?.trim() : undefined;
  const clerkPhone = isLoaded && user ? user.primaryPhoneNumber?.phoneNumber : undefined;

  const displayName = nameOverride ?? clerkName ?? 'Mert';
  const username =
    usernameOverride ??
    clerkUsername ??
    (user ? `p_${user.id.slice(-8)}` : 'mert_42');

  return {
    displayName,
    username,
    phone: clerkPhone ?? '—',
    initial: (displayName.charAt(0) || 'M').toUpperCase(),
  };
}
