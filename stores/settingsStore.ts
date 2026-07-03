import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

type CityKey = 'istanbul' | 'ankara' | 'izmir';
// Theme PREFERENCE. 'system' follows the OS; 'light'/'dark' force a scheme.
export type ColorScheme = 'system' | 'light' | 'dark';

type SettingsStore = {
  // Default follows the system; the toggle can force light or dark.
  scheme: ColorScheme;
  setScheme: (v: ColorScheme) => void;

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

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      scheme: 'system',
      setScheme: (v) => set({ scheme: v }),

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
    }),
    {
      name: 'playbox.settings',
      storage: createJSONStorage(() => AsyncStorage),
      version: 1,
    }
  )
);
