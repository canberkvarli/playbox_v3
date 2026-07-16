import { useAuthSession } from '@/hooks/useAuthSession';
import { isDeveloperPhone } from '@/constants/review';

/**
 * True when the logged-in user is a developer (their phone is in
 * DEVELOPER_PHONES). Gate developer-only UI on this so it appears in RELEASE
 * builds for the dev account but stays hidden from real users AND from App
 * Store reviewers (who match REVIEW_PHONE, not DEVELOPER_PHONES).
 *
 * Supabase strips the leading `+` from `user.phone` and it's occasionally blank
 * after a session round-trip, so we fall back to user_metadata.phone (mirrored
 * there at OTP-verify time), same as useDisplayUser.
 */
export function useIsDeveloper(): boolean {
  const { user } = useAuthSession();
  const metaPhone = (user?.user_metadata as { phone?: string } | undefined)?.phone;
  return isDeveloperPhone(user?.phone) || isDeveloperPhone(metaPhone);
}
