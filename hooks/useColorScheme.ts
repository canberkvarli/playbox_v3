import { useSettingsStore } from '@/stores/settingsStore';

/**
 * Playbox is LIGHT by default; dark is a persisted opt-in (settings toggle).
 * The value comes from the settings store, not the OS — people shouldn't get
 * dark just because their phone is dark on a bright day.
 */
export function useColorScheme(): 'light' | 'dark' {
  return useSettingsStore((s) => s.scheme);
}
