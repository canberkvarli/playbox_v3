export const palette = {
  paper:  '#ffffff', // pure white — matches QR + phone screen contrast on hardware
  ink:    '#1a1f3a', // deep midnight navy — body / primary text
  mauve:  '#a85a8e', // soft purple — reserved for logo speed-line highlights
  coral:  '#e87527', // warm basketball orange — primary action / handles / dots / numbers
  butter: '#f5d4b8', // pale peach — soft warm companion to coral
} as const;

export const darkSurfaces = {
  bg:     palette.ink,
  fg:     palette.paper,
  accent: palette.coral,
  warm:   palette.butter,
  muted:  palette.mauve,
} as const;

export type PaletteKey = keyof typeof palette;
