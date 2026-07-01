import { useColorScheme } from './useColorScheme';
import { themeFor } from '@/constants/theme';

export type ThemeColors = {
  bg: string;         // app background (asphalt)
  surface: string;    // card surface
  surfaceAlt: string; // raised surface / input
  deep: string;       // deepest well
  fg: string;         // primary text
  muted: string;      // secondary text
  border: string;     // hairline border
  bgSubtle: string;   // fg @ 14% — subtle fills/dividers
  fgSubtle: string;   // fg @ 60% — secondary text via alpha
  // Brand accents — constant across schemes
  volt: string;       // primary action
  voltInk: string;    // text/icon on volt
  danger: string;     // destructive (coral)
  // Legacy aliases kept for existing callers
  accent: string;     // -> volt
  warm: string;       // -> danger/coral
  coral: string;      // -> volt (legacy name)
  butter: string;     // -> danger/coral (legacy name)
  mauve: string;      // -> muted (legacy name)
  isDark: boolean;
};

/**
 * Theme-aware colors for places NativeWind classes can't reach: MapView markers,
 * BlurView tints, BottomSheet backgrounds, shadows, SVG strokes. Dark by default.
 */
export function useTheme(): ThemeColors {
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';
  const p = themeFor(scheme);
  return {
    bg:         p.bg,
    surface:    p.surface,
    surfaceAlt: p.surfaceAlt,
    deep:       p.deep,
    fg:         p.fg,
    muted:      p.muted,
    border:     p.border,
    bgSubtle:   p.fg + '14',
    fgSubtle:   p.fg + '99',
    volt:       p.volt,
    voltInk:    p.voltInk,
    danger:     p.danger,
    accent:     p.volt,
    warm:       p.danger,
    coral:      p.coral,
    butter:     p.butter,
    mauve:      p.mauve,
    isDark,
  };
}
