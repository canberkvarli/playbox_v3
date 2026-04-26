/**
 * Single source of truth for session pricing. Anything that talks money in
 * the UI should pull from here so changing the rate or VAT is one edit, not
 * a grep across screens.
 *
 * KDV (Turkish VAT) is 18% as of 2026 — adjust if the law changes.
 */
export const RATE_PER_MIN_TRY = 1.5;
export const KDV_RATE = 0.18;

/** Per-minute rate including KDV — what we actually charge per minute. */
export const RATE_PER_MIN_GROSS = +(RATE_PER_MIN_TRY * (1 + KDV_RATE)).toFixed(2);

/** Cost for an exact (rounded-up) minute count, KDV included. */
export function costForMinutes(minutes: number): number {
  const m = Math.max(0, Math.ceil(minutes));
  return +(m * RATE_PER_MIN_TRY * (1 + KDV_RATE)).toFixed(2);
}

/** Cost for an elapsed millisecond span, rounded up to the minute. */
export function costForMs(ms: number): number {
  return costForMinutes(Math.ceil(ms / 60_000));
}

/** Format a TRY amount as "₺12.40". Trims trailing zeros for whole liras. */
export function formatTry(amount: number): string {
  if (Number.isNaN(amount)) return '₺0';
  const rounded = Math.round(amount * 100) / 100;
  const isWhole = Math.abs(rounded - Math.round(rounded)) < 0.005;
  return `₺${isWhole ? Math.round(rounded) : rounded.toFixed(2)}`;
}
