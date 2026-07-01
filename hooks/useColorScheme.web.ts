import { useColorScheme as useSystemColorScheme } from 'react-native';

import { useSettingsStore } from '@/stores/settingsStore';

// Follows the OS by default; the toggle can force light or dark.
export function useColorScheme(): 'light' | 'dark' {
  const pref = useSettingsStore((s) => s.scheme);
  const system = useSystemColorScheme();
  if (pref === 'light' || pref === 'dark') return pref;
  return system === 'light' ? 'light' : 'dark';
}
