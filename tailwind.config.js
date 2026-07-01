/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  presets: [require('nativewind/preset')],
  // Dark-first (Asphalt Volt). The static color values below are the DARK
  // defaults, mirrored from constants/theme.ts (single source of truth).
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // LIGHT (default) values. Static className colors don't react to the
        // runtime scheme toggle; the app is light-first so these mirror the
        // light ramp. Inline `palette.X` styles flip for dark via root remount.
        // Legacy key names kept.
        paper:  '#F4F3EE', // cream — app background
        ink:    '#2A2C33', // primary foreground/text
        mauve:  '#6B6B75', // muted/secondary text
        coral:  '#D6FB3C', // VOLT — primary action
        butter: '#FF5C39', // CORAL — destructive
        // Additive semantic colors (preferred for new/reskinned code).
        bg:         '#F4F3EE',
        surface:    '#FFFFFF',
        'surface-alt': '#F4F3EE',
        deep:       '#E2E0D8',
        fg:         '#2A2C33',
        muted:      '#6B6B75',
        border:     '#E2E0D8',
        volt:       '#D6FB3C',
        'volt-ink': '#17181C',
        'volt-text': '#3F6212', // readable accent TEXT on light (volt fills stay bright)
        danger:     '#FF5C39',
      },
      fontFamily: {
        // Anton is loaded under the legacy Unbounded_* keys (see useLoadedFonts),
        // so these display slots render Anton. Anton ships a single weight.
        display:   ['Unbounded_700Bold'],
        'display-x': ['Unbounded_800ExtraBold'],
        sans:      ['Inter_400Regular'],
        medium:    ['Inter_500Medium'],
        semibold:  ['Inter_600SemiBold'],
        mono:      ['JetBrainsMono_400Regular'],
        'mono-medium': ['JetBrainsMono_500Medium'],
        'mono-bold': ['JetBrainsMono_700Bold'],
      },
      borderRadius: {
        xl: '20px',
        '2xl': '28px',
        '3xl': '40px',
        pill: '999px',
      },
    },
  },
  plugins: [],
};
