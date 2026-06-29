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
        // Kept in sync with constants/theme.ts (single warm palette). These used
        // to be a separate purple/plum set (#572c57 ink, #9f5f91 mauve, rose
        // coral, yellow butter), which clashed with the inline palette AND read
        // close to competitor Equip's violet. Unified to the warm slow-living set.
        paper:  '#ffffff',
        ink:    '#2e2419', // deep espresso brown
        mauve:  '#b5654a', // warm terracotta (was purple)
        coral:  '#e87527', // warm orange
        butter: '#f5d4b8', // pale peach
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
