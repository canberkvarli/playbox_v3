export const palette = {
  paper:  '#f5f5f5',
  ink:    '#572c57',
  mauve:  '#9f5f91',
  coral:  '#e26972',
  butter: '#f6ea98',
} as const;

export const darkSurfaces = {
  bg:     palette.ink,
  fg:     palette.paper,
  accent: palette.coral,
  warm:   palette.butter,
  muted:  palette.mauve,
} as const;

export type PaletteKey = keyof typeof palette;
