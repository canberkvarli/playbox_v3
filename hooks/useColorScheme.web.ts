import { useSettingsStore } from '@/stores/settingsStore';

// Light by default on web too (mirrors native). Reads the persisted preference.
export function useColorScheme(): 'light' | 'dark' {
  return useSettingsStore((s) => s.scheme);
}
