import { create } from 'zustand';

type DevStore = {
  bypass: boolean;
  setBypass: (v: boolean) => void;
  fakeActiveSession: boolean;
  setFakeActiveSession: (v: boolean) => void;
};

export const useDevStore = create<DevStore>((set) => ({
  bypass: false,
  setBypass: (bypass) => set({ bypass }),
  fakeActiveSession: false,
  setFakeActiveSession: (fakeActiveSession) => set({ fakeActiveSession }),
}));
