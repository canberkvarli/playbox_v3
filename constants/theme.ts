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
  voltText:   '#D6FB3C', // accent TEXT — bright volt reads fine on dark
} as const;

const lightNeutral = {
  bg:         '#F4F3EE',
  surface:    '#FFFFFF',
  surfaceAlt: '#F4F3EE',
  deep:       '#E2E0D8',
  fg:         '#2A2C33',
  muted:      '#6B6B75',
  border:     '#E2E0D8',
  voltText:   '#D6FB3C', // brand green stays bright — readability handled by DARK carriers, not by dulling the green
} as const;

type Neutral = { [K in keyof typeof darkNeutral]: string };

// Build a palette (legacy keys + additive semantic keys) for a given scheme.
function paletteFor(n: Neutral) {
  return {
    // legacy keys (values remapped to Asphalt Volt)
    paper:  n.bg,        // was cream bg   -> asphalt bg
    ink:    n.fg,        // was plum text  -> light fg
    mauve:  n.muted,     // was teal       -> muted
    coral:  brand.volt,  // was coral      -> VOLT (primary action)
    butter: brand.coral, // was tangerine  -> CORAL (destructive)
    // additive semantic keys (no churn; new/reskinned code uses these)
    bg:         n.bg,
    surface:    n.surface,
    surfaceAlt: n.surfaceAlt,
    deep:       n.deep,
    fg:         n.fg,
    muted:      n.muted,
    border:     n.border,
    volt:       brand.volt,     // FILL — always bright lime (use voltInk for text on it)
    voltInk:    brand.voltInk,
    voltText:   n.voltText,     // accent TEXT color — readable per scheme
    danger:     brand.coral,
  } as const;
}

export type PaletteKey = keyof ReturnType<typeof paletteFor>;
type Palette = Record<PaletteKey, string>;

export const lightPalette: Palette = paletteFor(lightNeutral);
export const darkPalette: Palette = paletteFor(darkNeutral);

// MUTABLE singleton, seeded LIGHT (the default scheme). ~980 call sites read
// `palette.X` directly and can't react to a hook, so `applyScheme` swaps the
// values IN PLACE and the root remounts (`key={scheme}` in app/_layout.tsx) so
// every static read refreshes. Light is default; dark is a settings toggle.
export const palette: Palette = { ...lightPalette };

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
