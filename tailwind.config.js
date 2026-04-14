/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        paper:  '#f5f5f5',
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
