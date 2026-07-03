// ASPHALT VOLT — dark-first identity. Single source of truth for colors.
// (Mirrored exactly in tailwind.config.js.)
//
// The static `palette` below holds the DARK (default) values. ~980 call sites
// read `palette.X` directly, so remapping the VALUES here repaints the whole
// app. The legacy key NAMES are kept (no file churn); their roles shifted:
//   paper = app background   ·  ink = primary foreground/text
//   coral = primary action (now VOLT)  ·  butter = destructive (now CORAL)
//   mauve = muted/secondary text
// New code should prefer the additive semantic keys (surface, border, volt,
// voltInk, danger, …) or the scheme-aware useTheme() hook for light fallback.

// Scheme-independent brand constants.
export const brand = {
  volt:    '#D6FB3C', // primary action — electric lime
  coral:   '#FF5C39', // destructive / warm accent
  voltInk: '#17181C', // text + icons that sit ON volt (always dark)
} as const;

// Neutral ramps per scheme.
const darkNeutral = {
  bg:         '#17181C', // asphalt — app background
  surface:    '#202127', // cards
  surfaceAlt: '#23252E', // raised surfaces / inputs
  deep:       '#0D0D10', // deepest wells
  fg:         '#F4F3EE', // primary text
  muted:      '#9A9AA6', // secondary text
  border:     '#3A3C45', // hairline border
  // Per-scheme ACCENT. Dark = volt green; light = coral/orange (green is
  // unreadable on white, so light swaps the whole accent to orange).
  accent:     '#D6FB3C', // volt green
  accentInk:  '#17181C', // dark text/icons on the accent
} as const;

const lightNeutral = {
  bg:         '#F4F3EE',
  surface:    '#FFFFFF',
  surfaceAlt: '#F4F3EE',
  deep:       '#E2E0D8',
  fg:         '#2A2C33',
  muted:      '#6B6B75',
  border:     '#E2E0D8',
  accent:     '#FF5C39', // coral/orange — light-mode accent (no green on white)
  accentInk:  '#FFFFFF', // white text/icons on the orange
} as const;

type Neutral = { [K in keyof typeof darkNeutral]: string };

// Build a palette (legacy keys + additive semantic keys) for a given scheme.
function paletteFor(n: Neutral) {
  return {
    // legacy keys (values remapped to Asphalt Volt)
    paper:  n.bg,        // was cream bg   -> asphalt bg
    ink:    n.fg,        // was plum text  -> light fg
    mauve:  n.muted,     // was teal       -> muted
    coral:  n.accent,    // legacy "primary action" key -> scheme accent
    butter: brand.coral, // was tangerine  -> CORAL (destructive)
    // additive semantic keys (no churn; new/reskinned code uses these)
    bg:         n.bg,
    surface:    n.surface,
    surfaceAlt: n.surfaceAlt,
    deep:       n.deep,
    fg:         n.fg,
    muted:      n.muted,
    border:     n.border,
    volt:       n.accent,     // ACCENT FILL — green (dark) / orange (light)
    voltInk:    n.accentInk,  // text/icons on the accent
    voltText:   n.accent,     // accent TEXT — green on dark, orange on light
    danger:     brand.coral,
  } as const;
}

export type PaletteKey = keyof ReturnType<typeof paletteFor>;
type Palette = Record<PaletteKey, string>;

export const lightPalette: Palette = paletteFor(lightNeutral);
export const darkPalette: Palette = paletteFor(darkNeutral);

// MUTABLE singleton, seeded DARK. The app is dark-only (light theme removed);
// `applyScheme` + the root remount machinery stays in place in case light is
// ever revisited, but useColorScheme always resolves 'dark'.
export const palette: Palette = { ...darkPalette };

export function applyScheme(scheme: 'light' | 'dark') {
  Object.assign(palette, scheme === 'dark' ? darkPalette : lightPalette);
}

export function themeFor(scheme: 'light' | 'dark') {
  return scheme === 'dark' ? darkPalette : lightPalette;
}

// Back-compat: a few callers referenced darkSurfaces (always the dark ramp).
export const darkSurfaces = {
  bg:     darkPalette.bg,
  fg:     darkPalette.fg,
  accent: darkPalette.volt,
  warm:   darkPalette.danger,
  muted:  darkPalette.muted,
} as const;
