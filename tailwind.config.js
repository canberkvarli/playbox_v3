/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  presets: [require('nativewind/preset')],
  // Light-locked for now. `dark:` variants only fire if an explicit dark class
  // is set higher in the tree (none today). To re-enable system-driven dark
  // mode later, switch back to 'media' and unlock useColorScheme.
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Kept in sync with constants/theme.ts (single source of truth). PLAYBOX
        // "punchy" palette. Key names are legacy; the values are what matter.
        paper:  '#FFF1E0', // cream
        ink:    '#2A1726', // plum
        mauve:  '#1FB8A6', // teal (legacy key name)
        coral:  '#FF6B4A', // coral
        butter: '#FFA23E', // tangerine (legacy key name)
      },
      fontFamily: {
        display:   ['Unbounded_700Bold'],
        'display-x': ['Unbounded_800ExtraBold'],
        sans:      ['Inter_400Regular'],
        medium:    ['Inter_500Medium'],
        semibold:  ['Inter_600SemiBold'],
        mono:      ['JetBrainsMono_400Regular'],
      },
      borderRadius: {
        xl: '20px',
        '2xl': '28px',
      },
    },
  },
  plugins: [],
};
