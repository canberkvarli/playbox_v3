import { useColorScheme as useSystemColorScheme } from 'react-native';

/**
 * Asphalt Volt is dark-first. We default to 'dark' and only honour an explicit
 * system 'light' preference (light is a supported fallback, dark is the brand).
 * To hard-lock dark, return 'dark' unconditionally.
 */
export function useColorScheme(): 'light' | 'dark' {
  const system = useSystemColorScheme();
  return system === 'light' ? 'light' : 'dark';
}
