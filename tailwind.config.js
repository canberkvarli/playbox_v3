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
        paper:  '#fafaf7',
        ink:    '#572c57',
        mauve:  '#9f5f91',
        coral:  '#e26972',
        butter: '#f6ea98',
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
