import { useSettingsStore } from '@/stores/settingsStore';

// Dark by default; light is an opt-in toggle. Reads the persisted preference.
export function useColorScheme(): 'light' | 'dark' {
  return useSettingsStore((s) => s.scheme);
}
