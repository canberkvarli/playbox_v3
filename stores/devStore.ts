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
  /**
   * When ON, the BLE event handler ignores `unlock_timeout`, `return_timeout`,
   * and `ball_overdue` notifications from the firmware. Use this during bench
   * bring-up without reed switches wired — the firmware will auto-timeout
   * every gate state because reed-closed never arrives, and we don't want
   * the app's session to be cancelled or banner-spammed on every test cycle.
   * Turn OFF before testing with real reeds.
   */
  ignoreFirmwareTimeouts: boolean;
  setIgnoreFirmwareTimeouts: (v: boolean) => void;
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
      ignoreFirmwareTimeouts: true,
      setIgnoreFirmwareTimeouts: (ignoreFirmwareTimeouts) =>
        set({ ignoreFirmwareTimeouts }),
    }),
    {
      name: 'playbox.dev',
      storage: safeStorage,
    }
  )
);
