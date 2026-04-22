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

  setCard: (info: SetCardInput) => void;
  clearCard: () => void;
  markFreeFirstUsed: () => void;
  setHold: (id: string | null) => void;

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

      setCard: ({ last4, brand }) =>
        set({ cardStatus: 'on_file', cardLast4: last4, cardBrand: brand }),

      clearCard: () =>
        set({ cardStatus: 'none', cardLast4: null, cardBrand: null }),

      markFreeFirstUsed: () => set({ freeFirstUsed: true }),

      setHold: (id) => set({ currentHoldId: id }),

      needsCardBeforeStart: () => {
        const s = get();
        return s.cardStatus === 'none' && s.freeFirstUsed;
      },
    }),
    {
      name: 'playbox.payment',
      storage: safeStorage,
    }
  )
);
