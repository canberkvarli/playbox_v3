import { create } from 'zustand';

type CityKey = 'istanbul' | 'ankara' | 'izmir';

type SettingsStore = {
  notifReturnReminder: boolean;
  notifFriendActivity: boolean;
  setReturnReminder: (v: boolean) => void;
  setFriendActivity: (v: boolean) => void;

  nameOverride: string | null;
  usernameOverride: string | null;
  cityOverride: CityKey | null;
  setNameOverride: (v: string | null) => void;
  setUsernameOverride: (v: string | null) => void;
  setCityOverride: (v: CityKey | null) => void;
};

export const useSettingsStore = create<SettingsStore>((set) => ({
  notifReturnReminder: true,
  notifFriendActivity: true,
  setReturnReminder: (v) => set({ notifReturnReminder: v }),
  setFriendActivity: (v) => set({ notifFriendActivity: v }),

  nameOverride: null,
  usernameOverride: null,
  cityOverride: null,
  setNameOverride: (v) => set({ nameOverride: v }),
  setUsernameOverride: (v) => set({ usernameOverride: v }),
  setCityOverride: (v) => set({ cityOverride: v }),
}));
