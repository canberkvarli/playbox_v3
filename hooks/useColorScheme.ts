import { useSettingsStore } from '@/stores/settingsStore';

/**
 * DARK by default; light is an opt-in toggle (settings → görünüm). Light mode
 * swaps the green accent for the coral/orange so nothing green sits on white.
 */
export function useColorScheme(): 'light' | 'dark' {
  return useSettingsStore((s) => s.scheme);
}
