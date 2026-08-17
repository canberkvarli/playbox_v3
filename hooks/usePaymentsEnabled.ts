import { useEffect } from 'react';

import { supabase } from '@/lib/supabase';
import { usePaymentStore } from '@/stores/paymentStore';

/**
 * Mirrors `app_config.payments_enabled` into the payment store on launch.
 *
 * This is the switch between FREE mode and PAID mode for the whole app:
 *
 *   false → no card gate, no ₺ preauth hold, no capture on return.
 *   true  → the existing iyzico flow, unchanged.
 *
 * Flip the row in Supabase and every client picks it up on its next cold launch
 * — no rebuild, no App Review round. That matters because payments are blocked
 * on the şirket + iyzico production credentials, and the app should not have to
 * wait on paperwork to ship.
 *
 * Launch-only, like useOtaAutoUpdate: re-reading on foreground could flip a user
 * into paid mode in the middle of a rental they started for free.
 *
 * FAILURE IS FREE, DELIBERATELY. Network down, table missing, RLS wrong, row
 * absent — all leave the persisted value alone (which starts false). Never
 * assume paid on a failed read: the cost of guessing wrong that way is a user
 * standing at a locker being asked for a card that the backend may not even be
 * able to charge yet.
 */
export function usePaymentsEnabled() {
  const setPaymentsEnabled = usePaymentStore((s) => s.setPaymentsEnabled);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const { data, error } = await supabase
          .from('app_config')
          .select('value')
          .eq('key', 'payments_enabled')
          .maybeSingle();

        if (cancelled || error || !data) return;

        // Stored as jsonb, so it arrives as a real boolean. Tolerate the string
        // form too in case someone edits the row by hand in the dashboard.
        const raw = (data as { value: unknown }).value;
        const on = raw === true || raw === 'true';
        setPaymentsEnabled(on);
      } catch {
        // Best-effort — leave the persisted value untouched.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [setPaymentsEnabled]);
}
