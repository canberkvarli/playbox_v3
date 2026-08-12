import { router } from 'expo-router';

/**
 * Leave the app for onboarding with NO authenticated screen left behind it.
 *
 * `router.replace()` only swaps the TOP entry of the stack. Signing out from
 * /settings left the stack as `[(tabs), (onboarding)/welcome]` — welcome was on
 * screen, but the whole signed-in app was still sitting underneath it. The iOS
 * edge-swipe then popped straight back into it, showing the previous account's
 * screens after a sign-out. That is the "swipe left and I'm logged in again"
 * bug, and it applies equally to account deletion and to backing out of KVKK.
 *
 * `dismissAll()` unwinds to the root first, so the replace has nothing to sit on
 * top of and there is no back target left to swipe to.
 *
 * Note this is a NAVIGATION fix, not an auth fix — the Supabase session is
 * already gone by the time we get here, so the screens underneath were showing
 * stale rendered state rather than live data. It still has to be fixed: a user
 * who signs out must not be able to gesture their way back into the account.
 */
export function resetToOnboarding(): void {
  try {
    if (router.canDismiss()) router.dismissAll();
  } catch {
    // Already at the root, or not inside a dismissable stack. The replace below
    // is still correct — never let teardown navigation throw at the user.
  }
  router.replace('/(onboarding)/welcome');
}
