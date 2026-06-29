/**
 * Single source of truth for session pricing. Anything that talks money in
 * the UI should pull from here so changing the rate or VAT is one edit, not
 * a grep across screens.
 *
 * KDV (Turkish VAT) standard rate is 20% (raised from 18% in July 2023,
 * Decree 7346; still 20% in 2026). Sports-equipment rental is a standard-rate
 * supply — it is NOT in the reduced 1% (List I) or 10% (List II) lists, whose
 * cultural-entry row covers cinema/theatre/museum only, not sports. Confirm the
 * exact classification with a mali müşavir; adjust here if the law changes.
 */
export const RATE_PER_MIN_TRY = 1.5;
export const KDV_RATE = 0.2;

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
