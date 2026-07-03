import { useEffect } from 'react';

import { useAuthSession } from '@/hooks/useAuthSession';
import { useDevStore } from '@/stores/devStore';
import { REVIEW_PHONE } from '@/constants/review';

const digits = (s?: string | null) => (s ?? '').replace(/\D/g, '');

/**
 * Auto-enables Demo Mode when the App Store review account (REVIEW_PHONE) is the
 * logged-in user, and disables it for any real user. Mount once at the root.
 * With Demo Mode on, getDriver() returns the mock hardware driver even in a
 * release build, so a reviewer can run the whole flow without a locker.
 */
export function useReviewerDemo() {
  const { user } = useAuthSession();
  const setDemoMode = useDevStore((s) => s.setDemoMode);

  useEffect(() => {
    const phone = user?.phone;
    if (!phone) return; // logged out / no phone yet → leave the flag untouched
    setDemoMode(digits(phone) === digits(REVIEW_PHONE));
  }, [user?.phone, setDemoMode]);
}
