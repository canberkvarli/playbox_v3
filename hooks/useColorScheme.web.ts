// Asphalt Volt is dark-first. On web we render dark to match the native default
// and keep first-paint stable (no media-query flash).
export function useColorScheme(): 'light' | 'dark' {
  return 'dark';
}
