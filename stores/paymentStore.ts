import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { safeStorage } from '@/lib/safeStorage';

export type CardStatus = 'none' | 'on_file';

type SetCardInput = {
  last4: string;
  brand: string;
};

type PaymentStore = {
  cardStatus: CardStatus;
  freeFirstUsed: boolean;
  cardLast4: string | null;
  cardBrand: string | null;
  currentHoldId: string | null;
  /**
   * Server-controlled kill switch for the whole money path, mirrored from
   * `app_config.payments_enabled` on launch (see usePaymentsEnabled).
   *
   * FALSE = free mode: no card gate, no ₺ preauth hold, no capture on return.
   * The rental itself is unchanged — reserve, unlock, play and return all work
   * exactly the same, they just cost nothing.
   *
   * Exists so payments can be switched on from the dashboard the day the şirket
   * and the iyzico production account are ready, WITHOUT shipping a new build
   * and waiting on App Review again.
   *
   * Defaults FALSE and stays FALSE if the config fetch fails. A user wrongly let
   * in for free is a rounding error; a user wrongly shown a card wall at a
   * station they are standing in front of is a support ticket and a 1-star
   * review.
   */
  paymentsEnabled: boolean;

  setCard: (info: SetCardInput) => void;
  clearCard: () => void;
  markFreeFirstUsed: () => void;
  setHold: (id: string | null) => void;
  setPaymentsEnabled: (v: boolean) => void;

  needsCardBeforeStart: () => boolean;
};

export const usePaymentStore = create<PaymentStore>()(
  persist(
    (set, get) => ({
      cardStatus: 'none',
      freeFirstUsed: false,
      cardLast4: null,
      cardBrand: null,
      currentHoldId: null,
      paymentsEnabled: false,

      setCard: ({ last4, brand }) =>
        set({ cardStatus: 'on_file', cardLast4: last4, cardBrand: brand }),

      clearCard: () =>
        set({ cardStatus: 'none', cardLast4: null, cardBrand: null }),

      markFreeFirstUsed: () => set({ freeFirstUsed: true }),

      setHold: (id) => set({ currentHoldId: id }),

      setPaymentsEnabled: (paymentsEnabled) => set({ paymentsEnabled }),

      needsCardBeforeStart: () => {
        const s = get();
        if (!s.paymentsEnabled) return false; // free mode — never ask for a card
        return s.cardStatus === 'none' && s.freeFirstUsed;
      },
    }),
    {
      name: 'playbox.payment',
      storage: safeStorage,
    }
  )
);
