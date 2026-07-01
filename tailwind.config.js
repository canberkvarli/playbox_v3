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
        // Legacy keys (values remapped to Asphalt Volt — names are legacy).
        paper:  '#17181C', // asphalt — app background  (was cream)
        ink:    '#F4F3EE', // primary foreground/text   (was plum)
        mauve:  '#9A9AA6', // muted/secondary text      (was teal)
        coral:  '#D6FB3C', // VOLT — primary action     (was coral)
        butter: '#FF5C39', // CORAL — destructive       (was tangerine)
        // Additive semantic colors (preferred for new/reskinned code).
        bg:         '#17181C',
        surface:    '#202127',
        'surface-alt': '#23252E',
        deep:       '#0D0D10',
        fg:         '#F4F3EE',
        muted:      '#9A9AA6',
        border:     '#3A3C45',
        volt:       '#D6FB3C',
        'volt-ink': '#17181C',
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
