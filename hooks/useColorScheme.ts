import { useColorScheme as useSystemColorScheme } from 'react-native';

import { useSettingsStore } from '@/stores/settingsStore';

/**
 * Resolves the effective scheme: the stored preference follows the OS by
 * default ('system'), and the settings toggle can force 'light' or 'dark'.
 * Light mode swaps the green accent for coral/orange (no green on white).
 */
export function useColorScheme(): 'light' | 'dark' {
  const pref = useSettingsStore((s) => s.scheme);
  const system = useSystemColorScheme();
  if (pref === 'light' || pref === 'dark') return pref;
  return system === 'light' ? 'light' : 'dark'; // 'system' → OS (fallback dark)
}
