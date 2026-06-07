import { canAttemptBle, type BtState } from './btState';

describe('canAttemptBle', () => {
  it('allows BLE when the radio is PoweredOn', () => {
    expect(canAttemptBle('PoweredOn')).toEqual({ ok: true });
  });

  it('blocks with reason "off" when PoweredOff', () => {
    expect(canAttemptBle('PoweredOff')).toEqual({ ok: false, reason: 'off' });
  });

  it('blocks with reason "unauthorized" when Unauthorized', () => {
    expect(canAttemptBle('Unauthorized')).toEqual({
      ok: false,
      reason: 'unauthorized',
    });
  });

  it('blocks with reason "unsupported" when Unsupported', () => {
    expect(canAttemptBle('Unsupported')).toEqual({
      ok: false,
      reason: 'unsupported',
    });
  });

  it('blocks with reason "transient" when Resetting', () => {
    expect(canAttemptBle('Resetting')).toEqual({
      ok: false,
      reason: 'transient',
    });
  });

  it('blocks with reason "transient" when Unknown', () => {
    expect(canAttemptBle('Unknown')).toEqual({
      ok: false,
      reason: 'transient',
    });
  });

  it('covers every BtState value with a deterministic decision', () => {
    const states: BtState[] = [
      'PoweredOn',
      'PoweredOff',
      'Unauthorized',
      'Unsupported',
      'Resetting',
      'Unknown',
    ];
    for (const s of states) {
      const result = canAttemptBle(s);
      if (s === 'PoweredOn') {
        expect(result.ok).toBe(true);
      } else {
        expect(result.ok).toBe(false);
      }
    }
  });
});
