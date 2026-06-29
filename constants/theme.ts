export const palette = {
  paper:  '#ffffff', // pure white — matches QR + phone screen contrast on hardware
  ink:    '#1a1f3a', // deep midnight navy — body / primary text
  // Warm terracotta secondary accent. NOTE: key is still named `mauve` for
  // back-compat, but the value is no longer purple — purple echoed competitor
  // Equip's violet brand (#513DC4), so it was swapped to terracotta to fit the
  // warm slow-living palette and stay visually distinct from Equip.
  mauve:  '#b5654a',
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
