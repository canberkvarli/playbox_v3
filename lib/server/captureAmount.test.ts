// Jest tests for the PURE capture amount-clamp (money safety). Imports the
// Deno-free module directly.
import { clampCaptureAmount } from '../../supabase/functions/iyzico-capture-release/captureAmount';

const HOLD = 150;

describe('clampCaptureAmount', () => {
  it('passes a normal in-range amount through', () => {
    expect(clampCaptureAmount(80, HOLD)).toBe(80);
  });

  it('caps an over-hold request at the hold (no over-charge)', () => {
    expect(clampCaptureAmount(99999, HOLD)).toBe(150);
  });

  it('defaults to the hold when the amount is missing', () => {
    expect(clampCaptureAmount(undefined, HOLD)).toBe(150);
  });

  it('floors a negative request at 0', () => {
    expect(clampCaptureAmount(-50, HOLD)).toBe(0);
  });

  it('falls back to the hold on NaN / non-numeric input', () => {
    expect(clampCaptureAmount(NaN, HOLD)).toBe(150);
    expect(clampCaptureAmount('abc', HOLD)).toBe(150);
    expect(clampCaptureAmount({}, HOLD)).toBe(150);
  });

  it('coerces a numeric string', () => {
    expect(clampCaptureAmount('50', HOLD)).toBe(50);
  });

  it('INVARIANT: output is always within [0, hold] for any input', () => {
    const inputs = [0, 1, 75, 150, 151, 1000, -1, undefined, null, NaN, 'x', '200', {}];
    for (const v of inputs) {
      const out = clampCaptureAmount(v, HOLD);
      expect(out).toBeGreaterThanOrEqual(0);
      expect(out).toBeLessThanOrEqual(HOLD);
    }
  });
});
