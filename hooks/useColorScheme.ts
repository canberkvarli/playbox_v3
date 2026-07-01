/**
 * Playbox is DARK-ONLY. Light theme was removed — always resolve 'dark'.
 * (The store still holds a `scheme` field for possible future use, but the app
 * ignores it here.)
 */
export function useColorScheme(): 'light' | 'dark' {
  return 'dark';
}
