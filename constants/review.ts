/**
 * App Store REVIEW / DEMO account.
 *
 * When this phone number is the logged-in user, the app auto-enables Demo Mode
 * (mock hardware driver — the full unlock → session → return flow works with NO
 * physical locker). This is how Apple reviews a hardware-companion app without
 * the hardware present, avoiding a Guideline 2.1 rejection.
 *
 * SETUP (Supabase, user-run): add a "Test OTP" for this exact number in the
 * Supabase dashboard → Authentication → Providers → Phone → Test OTP, mapping
 * REVIEW_PHONE → a fixed 6-digit code. The reviewer then signs in with this
 * number + that code — no real SMS is sent. Keep the number here and the
 * Supabase entry in sync. Put both in the App Store Connect review notes.
 */
export const REVIEW_PHONE = '+905000000000'; // ← set to your chosen review number (E.164)

/**
 * DEMO LOGIN username. On the welcome screen, "Demo Login" → entering this
 * username (case-insensitive) drops the reviewer straight into the app in Demo
 * Mode — no phone/OTP, no SMS, no Supabase account. Put this exact username in
 * the App Store Connect review notes. Add more entries to accept several.
 */
export const DEMO_USERNAMES = ['appstore'];

export function isDemoUsername(input: string): boolean {
  const u = input.trim().toLowerCase().replace(/^@/, '');
  return DEMO_USERNAMES.some((d) => d.toLowerCase() === u);
}

/**
 * DEVELOPER phone numbers (E.164). When one of these is the logged-in user, the
 * app reveals developer-only controls (e.g. the bench servo / UNLOCK / RETURN
 * buttons on the station screen) even in a RELEASE build — see useIsDeveloper().
 *
 * This is intentionally distinct from REVIEW_PHONE: App Store reviewers get
 * Demo Mode (clean flow, mock hardware) but must NOT see the raw dev buttons.
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
