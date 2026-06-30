// PLAYBOX "punchy" palette — high-energy, active. Mapped onto the existing token
// keys so the whole app repaints from here (nothing hardcodes colors). The key
// NAMES are legacy (kept for back-compat); the VALUES below are the source of
// truth. tailwind.config.js mirrors these exactly.
export const palette = {
  paper:  '#FFF1E0', // cream — app background
  ink:    '#2A1726', // plum — primary text + all dark UI (borders, marker outlines)
  mauve:  '#1FB8A6', // teal — cool accent (key name 'mauve' is legacy)
  coral:  '#FF6B4A', // coral — primary action / handles / dots / numbers
  butter: '#FFA23E', // tangerine — warm secondary accent (key name 'butter' is legacy)
} as const;

export const darkSurfaces = {
  bg:     palette.ink,
  fg:     palette.paper,
  accent: palette.coral,
  warm:   palette.butter,
  muted:  palette.mauve,
} as const;

export type PaletteKey = keyof typeof palette;
