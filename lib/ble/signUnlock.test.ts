// signUnlock.ts imports '@/lib/supabase', which constructs a real Supabase
// client at module load and throws without env vars. We only exercise the pure
// body builder here, so stub the client module out.
jest.mock('@/lib/supabase', () => ({ supabase: {} }));

import { buildSignUnlockBody } from './signUnlock';

describe('buildSignUnlockBody', () => {
  const base = {
    stationId: 'DEV-001',
    gate: 1,
    sessionId: 'unlock:DEV-001:football:123',
  } as const;

  it('unlock with gateId includes gate_id, numeric gate, and duration_min', () => {
    const body = buildSignUnlockBody({
      cmd: 'unlock',
      ...base,
      durationMin: 30,
      gateId: 'DEV-001-football-1',
    });
    expect(body).toMatchObject({
      cmd: 'unlock',
      station_id: 'DEV-001',
      gate: 1,
      session_id: 'unlock:DEV-001:football:123',
      duration_min: 30,
      gate_id: 'DEV-001-football-1',
    });
    // numeric gate is unchanged (the HMAC input), distinct from the slug
    expect(body.gate).toBe(1);
    expect(typeof body.gate).toBe('number');
  });

  it('unlock without gateId omits the gate_id key entirely', () => {
    const undef = buildSignUnlockBody({ cmd: 'unlock', ...base, durationMin: 30 });
    expect('gate_id' in undef).toBe(false);

    const empty = buildSignUnlockBody({
      cmd: 'unlock',
      ...base,
      durationMin: 30,
      gateId: '',
    });
    expect('gate_id' in empty).toBe(false);
  });

  it('return_unlock has no duration_min and no gate_id (call site omits gateId)', () => {
    // fetchSignedReturnUnlock never threads a gateId — linkage is unlock-only.
    const body = buildSignUnlockBody({ cmd: 'return_unlock', ...base });
    expect(body.cmd).toBe('return_unlock');
    expect('duration_min' in body).toBe(false);
    expect('gate_id' in body).toBe(false);
  });

  it('dev_bypass is included when true and omitted/false otherwise', () => {
    const on = buildSignUnlockBody({ cmd: 'unlock', ...base, durationMin: 30, devBypass: true });
    expect(on.dev_bypass).toBe(true);

    const off = buildSignUnlockBody({ cmd: 'unlock', ...base, durationMin: 30, devBypass: false });
    expect('dev_bypass' in off).toBe(false);

    const missing = buildSignUnlockBody({ cmd: 'unlock', ...base, durationMin: 30 });
    expect('dev_bypass' in missing).toBe(false);
  });
});
