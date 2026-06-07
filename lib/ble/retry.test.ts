import {
  backoffSchedule,
  delayForAttempt,
  jitter,
  classifyBleError,
  isRetryable,
  BASE_DELAY_MS,
  MAX_DELAY_MS,
} from './retry';

describe('backoffSchedule', () => {
  it('produces the documented default schedule [200, 400, 800]', () => {
    expect(backoffSchedule()).toEqual([200, 400, 800]);
  });

  it('has length == maxRetries', () => {
    expect(backoffSchedule(3)).toHaveLength(3);
    expect(backoffSchedule(5)).toHaveLength(5);
    expect(backoffSchedule(1)).toHaveLength(1);
    expect(backoffSchedule(0)).toHaveLength(0);
  });

  it('is monotonically non-decreasing', () => {
    const s = backoffSchedule(6);
    for (let i = 1; i < s.length; i++) {
      expect(s[i]).toBeGreaterThanOrEqual(s[i - 1]);
    }
  });

  it('caps each delay at MAX_DELAY_MS (2000)', () => {
    const s = backoffSchedule(8);
    for (const d of s) expect(d).toBeLessThanOrEqual(MAX_DELAY_MS);
    // base 200 doubling: 200,400,800,1600,2000(capped from 3200),2000,2000,2000
    expect(s).toEqual([200, 400, 800, 1600, 2000, 2000, 2000, 2000]);
  });

  it('uses base 200ms and doubles each attempt before the cap', () => {
    expect(BASE_DELAY_MS).toBe(200);
    expect(MAX_DELAY_MS).toBe(2000);
    expect(delayForAttempt(0)).toBe(200);
    expect(delayForAttempt(1)).toBe(400);
    expect(delayForAttempt(2)).toBe(800);
    expect(delayForAttempt(3)).toBe(1600);
    expect(delayForAttempt(4)).toBe(2000); // capped
    expect(delayForAttempt(10)).toBe(2000); // capped
  });
});

describe('jitter', () => {
  // jitter applies +/- 25% of the delay, scaled by an injected fraction in
  // [0,1]. fraction=0.5 -> no change; 0 -> -25%; 1 -> +25%. Deterministic.
  it('returns the base delay when fraction is 0.5 (midpoint)', () => {
    expect(jitter(800, 0.5)).toBe(800);
  });

  it('subtracts up to 25% at fraction 0', () => {
    expect(jitter(800, 0)).toBe(600);
  });

  it('adds up to 25% at fraction 1', () => {
    expect(jitter(800, 1)).toBe(1000);
  });

  it('is bounded within +/-25% for any fraction in [0,1]', () => {
    for (let f = 0; f <= 1.0001; f += 0.1) {
      const j = jitter(1000, f);
      expect(j).toBeGreaterThanOrEqual(750);
      expect(j).toBeLessThanOrEqual(1250);
    }
  });

  it('is deterministic for a given fraction', () => {
    expect(jitter(400, 0.3)).toBe(jitter(400, 0.3));
  });
});

describe('classifyBleError', () => {
  it('classifies a GATT 133 / connection error as retryable', () => {
    expect(classifyBleError(new Error('GATT error status 133'))).toBe('retryable');
    expect(classifyBleError(new Error('Device disconnected'))).toBe('retryable');
    expect(classifyBleError(new Error('Operation timed out'))).toBe('retryable');
    expect(classifyBleError(new Error('connection failed'))).toBe('retryable');
    expect(classifyBleError({ errorCode: 201 })).toBe('retryable'); // DeviceDisconnected
  });

  it('classifies powered-off as bluetooth_off (terminal, not retryable)', () => {
    expect(classifyBleError(new Error('BluetoothLE is powered off'))).toBe('bluetooth_off');
    expect(classifyBleError(new Error('State is PoweredOff'))).toBe('bluetooth_off');
    expect(classifyBleError({ errorCode: 102 })).toBe('bluetooth_off'); // BluetoothPoweredOff
  });

  it('classifies unauthorized as unauthorized (terminal)', () => {
    expect(classifyBleError(new Error('Bluetooth unauthorized'))).toBe('unauthorized');
    expect(classifyBleError(new Error('permission denied'))).toBe('unauthorized');
    expect(classifyBleError({ errorCode: 101 })).toBe('unauthorized'); // BluetoothUnauthorized
  });

  it('classifies a signature rejection as signature_rejected (terminal)', () => {
    expect(classifyBleError(new Error('signature rejected by station'))).toBe(
      'signature_rejected',
    );
    expect(classifyBleError(new Error('invalid signature'))).toBe('signature_rejected');
    expect(classifyBleError(new Error('hmac mismatch'))).toBe('signature_rejected');
    expect(classifyBleError(new Error('unauthorized signature'))).toBe('signature_rejected');
  });

  it('defaults UNKNOWN errors to terminal (conservative — avoid hammering)', () => {
    expect(classifyBleError(new Error('something weird happened'))).toBe('terminal');
    expect(classifyBleError(null)).toBe('terminal');
    expect(classifyBleError(undefined)).toBe('terminal');
    expect(classifyBleError({})).toBe('terminal');
  });
});

describe('isRetryable', () => {
  it('is true only for retryable classification', () => {
    expect(isRetryable(new Error('GATT error status 133'))).toBe(true);
    expect(isRetryable(new Error('timeout'))).toBe(true);
  });

  it('is false for every terminal classification', () => {
    expect(isRetryable(new Error('powered off'))).toBe(false);
    expect(isRetryable(new Error('unauthorized'))).toBe(false);
    expect(isRetryable(new Error('signature rejected'))).toBe(false);
    expect(isRetryable(new Error('unknown gibberish'))).toBe(false);
  });
});
