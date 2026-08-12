/**
 * App Store REVIEW account.
 *
 * This is an ORDINARY account: it signs in through the normal phone + SMS code
 * screen, sees the normal UI, and has no badge, banner or "demo" affordance
 * anywhere. The ONLY difference is that getDriver() hands it the mock hardware
 * driver, so the unlock → session → return flow completes with no physical
 * locker present. That lets Apple review a hardware-companion app without a
 * locker (Guideline 2.1) while the app itself never presents itself as a demo
 * (Guideline 2.2).
 *
 * There is deliberately NO user-facing way to enter this state. It is keyed to
 * this one phone number only — see useReviewerDemo().
 *
 * SETUP (Supabase dashboard, user-run): Authentication → Sign In / Providers →
 * Phone → "Test Phone Numbers and OTPs". Comma-separated `<number>=<otp>` pairs,
 * NO leading '+':
 *
 *     905000000000=123456
 *
 * No SMS is sent for a listed number; the paired code always works. Check the
 * "Test OTPs Valid Until" date sitting well past any expected review date.
 *
 * CONSTRAINT — the number MUST be a Turkish mobile. The sign-in screen hardcodes
 * a +90 prefix and validates with isValidTrMobile() (10 digits, leading 5), so a
 * non-TR test number is literally untypeable by a reviewer. '5000000000' passes.
 *
 * Keep this constant and the dashboard entry in sync, and put the number + code
 * in the App Store Connect review notes.
 */
export const REVIEW_PHONE = '+905000000000';
export const REVIEW_OTP = '123456'; // documentation only — enforced by Supabase, not the app

/**
 * DEVELOPER phone numbers (E.164). When one of these is the logged-in user, the
 * app reveals developer-only controls (e.g. the bench servo / UNLOCK / RETURN
 * buttons on the station screen) even in a RELEASE build — see useIsDeveloper().
 *
 * This is intentionally distinct from REVIEW_PHONE: the review account gets the
 * clean flow on mock hardware but must NOT see the raw dev buttons.
 * Regular users match neither list, so they never see them either.
 */
export const DEVELOPER_PHONES = ['+905530242625'];

const digits = (s?: string | null) => (s ?? '').replace(/\D/g, '');

/** True when `phone` (any format; leading + optional) is a developer number. */
export function isDeveloperPhone(phone?: string | null): boolean {
  const p = digits(phone);
  if (!p) return false;
  return DEVELOPER_PHONES.some((d) => digits(d) === p);
}
