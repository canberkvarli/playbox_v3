export const palette = {
  paper:  '#fafaf7', // near-white background, slightly warm so it doesn't look clinical
  ink:    '#572c57', // dark purple — used as primary text + dark accent surfaces
  mauve:  '#9f5f91', // mid purple
  coral:  '#e26972', // primary action
  butter: '#f6ea98', // soft yellow accent
} as const;

export const darkSurfaces = {
  bg:     palette.ink,
  fg:     palette.paper,
  accent: palette.coral,
  warm:   palette.butter,
  muted:  palette.mauve,
} as const;

export type PaletteKey = keyof typeof palette;
