import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { safeStorage } from '@/lib/safeStorage';

type DevStore = {
  bypass: boolean;
  setBypass: (v: boolean) => void;
  fakeActiveSession: boolean;
  setFakeActiveSession: (v: boolean) => void;
};

export const useDevStore = create<DevStore>()(
  persist(
    (set) => ({
      bypass: false,
      setBypass: (bypass) => set({ bypass }),
      fakeActiveSession: false,
      setFakeActiveSession: (fakeActiveSession) => set({ fakeActiveSession }),
    }),
    {
      name: 'playbox.dev',
      storage: safeStorage,
    }
  )
);
