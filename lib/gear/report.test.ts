import {
  GEAR_REPORT_KINDS,
  isValidReportKind,
  returnPhotoPath,
  MAX_REPORT_MESSAGE,
  buildGearReportRow,
} from './report';

describe('returnPhotoPath', () => {
  it('builds the object path within the bucket (no bucket prefix)', () => {
    expect(returnPhotoPath('user1', 'sess1')).toBe('user1/sess1.jpg');
  });

  it('returns null for empty / whitespace userId', () => {
    expect(returnPhotoPath('', 'sess1')).toBeNull();
    expect(returnPhotoPath('   ', 'sess1')).toBeNull();
  });

  it('returns null for empty / whitespace bleSessionId', () => {
    expect(returnPhotoPath('user1', '')).toBeNull();
    expect(returnPhotoPath('user1', '   ')).toBeNull();
  });

  it('returns null when userId contains a slash or ..', () => {
    expect(returnPhotoPath('a/b', 'sess1')).toBeNull();
    expect(returnPhotoPath('..', 'sess1')).toBeNull();
    expect(returnPhotoPath('a..b', 'sess1')).toBeNull();
  });

  it('returns null when bleSessionId contains a slash or ..', () => {
    expect(returnPhotoPath('user1', 'a/b')).toBeNull();
    expect(returnPhotoPath('user1', '../evil')).toBeNull();
    expect(returnPhotoPath('user1', 'a..b')).toBeNull();
  });
});

describe('isValidReportKind', () => {
  it('accepts each valid kind', () => {
    for (const k of GEAR_REPORT_KINDS) {
      expect(isValidReportKind(k)).toBe(true);
    }
  });

  it('rejects unknown / non-string values', () => {
    expect(isValidReportKind('foo')).toBe(false);
    expect(isValidReportKind(null)).toBe(false);
    expect(isValidReportKind(undefined)).toBe(false);
    expect(isValidReportKind(42)).toBe(false);
    expect(isValidReportKind({})).toBe(false);
  });
});

describe('buildGearReportRow', () => {
  it('builds a minimal row (userId + kind) with status open and no optional keys', () => {
    const res = buildGearReportRow({ userId: 'user1', kind: 'lost' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.row).toEqual({ user_id: 'user1', kind: 'lost', status: 'open' });
    expect('ble_session_id' in res.row).toBe(false);
    expect('station_id' in res.row).toBe(false);
    expect('gate' in res.row).toBe(false);
    expect('message' in res.row).toBe(false);
    expect('photo_path' in res.row).toBe(false);
  });

  it('rejects an invalid kind', () => {
    const res = buildGearReportRow({ userId: 'user1', kind: 'nope' });
    expect(res).toEqual({ ok: false, error: 'invalid_kind' });
  });

  it('rejects an empty userId', () => {
    expect(buildGearReportRow({ userId: '', kind: 'lost' }).ok).toBe(false);
    expect(buildGearReportRow({ userId: '   ', kind: 'lost' }).ok).toBe(false);
  });

  it('builds a full snake_case row from full input', () => {
    const res = buildGearReportRow({
      userId: 'user1',
      bleSessionId: 'sess1',
      stationId: 'ist-taksim',
      gate: 3,
      kind: 'damaged',
      message: '  the strap is torn  ',
      photoPath: 'user1/sess1.jpg',
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.row).toEqual({
      user_id: 'user1',
      kind: 'damaged',
      ble_session_id: 'sess1',
      station_id: 'ist-taksim',
      gate: 3,
      message: 'the strap is torn',
      photo_path: 'user1/sess1.jpg',
      status: 'open',
    });
  });

  it('trims and caps the message at MAX_REPORT_MESSAGE', () => {
    const long = 'x'.repeat(MAX_REPORT_MESSAGE + 500);
    const res = buildGearReportRow({ userId: 'user1', kind: 'other', message: `   ${long}   ` });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect((res.row.message as string).length).toBe(MAX_REPORT_MESSAGE);
  });

  it('omits null / empty optionals (no empty strings or nulls inserted)', () => {
    const res = buildGearReportRow({
      userId: 'user1',
      kind: 'lost',
      bleSessionId: null,
      stationId: '',
      gate: null,
      message: '   ',
      photoPath: null,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect('ble_session_id' in res.row).toBe(false);
    expect('station_id' in res.row).toBe(false);
    expect('gate' in res.row).toBe(false);
    expect('message' in res.row).toBe(false);
    expect('photo_path' in res.row).toBe(false);
  });

  it('keeps gate 0 (a real value, not omitted)', () => {
    const res = buildGearReportRow({ userId: 'user1', kind: 'lost', gate: 0 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.row.gate).toBe(0);
  });
});
