import { useColorScheme as useSystemColorScheme } from 'react-native';

/**
 * Playbox is light-mode locked for now. We still consume the system hook so
 * React's hook-call order stays stable across reloads, but we always return
 * 'light'. To re-enable system-driven dark mode later, return the system value.
 */
export function useColorScheme(): 'light' {
  useSystemColorScheme();
  return 'light';
}
