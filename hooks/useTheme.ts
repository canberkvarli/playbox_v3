import { useColorScheme } from './useColorScheme';
import { palette } from '@/constants/theme';

export type ThemeColors = {
  bg: string;       // background surface
  fg: string;       // primary text
  bgSubtle: string; // card/border subtle (ink/14 in light -> paper/14 in dark)
  fgSubtle: string; // secondary text (ink/60 in light -> paper/60 in dark)
  accent: string;
  warm: string;
  muted: string;
  // Constants for quick access — same in both modes
  coral: string;
  butter: string;
  mauve: string;
  // Light/dark indicator for conditional logic
  isDark: boolean;
};

/**
 * Returns theme-aware colors. Use this in any place NativeWind classes can't reach:
 * MapView marker colors, BlurView tints, BottomSheet backgrounds, shadows, SVG strokes.
 */
export function useTheme(): ThemeColors {
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';
  return {
    bg:       isDark ? palette.ink   : palette.paper,
    fg:       isDark ? palette.paper : palette.ink,
    bgSubtle: (isDark ? palette.paper : palette.ink) + '14',
    fgSubtle: (isDark ? palette.paper : palette.ink) + '99',
    accent:   palette.coral,
    warm:     palette.butter,
    muted:    palette.mauve,
    coral:    palette.coral,
    butter:   palette.butter,
    mauve:    palette.mauve,
    isDark,
  };
}
