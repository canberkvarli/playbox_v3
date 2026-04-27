import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { safeStorage } from '@/lib/safeStorage';

type DevStore = {
  bypass: boolean;
  setBypass: (v: boolean) => void;
  fakeActiveSession: boolean;
  setFakeActiveSession: (v: boolean) => void;
  /**
   * Switch between the mock hardware driver and the real BLE driver from
   * inside a dev build. Lets you flip on real proximity scanning + the
   * `gate-unlock` Edge Function call without rebuilding the binary.
   * Read by lib/hardware/index.ts.
   */
  bleHardware: boolean;
  setBleHardware: (v: boolean) => void;
};

export const useDevStore = create<DevStore>()(
  persist(
    (set) => ({
      bypass: false,
      setBypass: (bypass) => set({ bypass }),
      fakeActiveSession: false,
      setFakeActiveSession: (fakeActiveSession) => set({ fakeActiveSession }),
      bleHardware: false,
      setBleHardware: (bleHardware) => set({ bleHardware }),
    }),
    {
      name: 'playbox.dev',
      storage: safeStorage,
    }
  )
);
