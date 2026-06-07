import { submitGearReport } from './submitGearReport';

/**
 * Recording fake deps. Each fake records its calls and is configurable to
 * resolve ok / fail, or to throw — so we can prove the photo-best-effort and
 * invalid-kind-guard semantics by exact call counts.
 */
type UploadOutcome =
  | { mode: 'ok'; path: string }
  | { mode: 'fail'; error: string }
  | { mode: 'throw'; error: string };

type InsertOutcome =
  | { mode: 'ok' }
  | { mode: 'fail'; error: string }
  | { mode: 'throw'; error: string };

function makeUpload(outcome: UploadOutcome) {
  const calls: Array<{ userId: string; bleSessionId: string; fileUri: string }> = [];
  const fn = async (userId: string, bleSessionId: string, fileUri: string) => {
    calls.push({ userId, bleSessionId, fileUri });
    if (outcome.mode === 'throw') throw new Error(outcome.error);
    if (outcome.mode === 'fail') return { ok: false as const, error: outcome.error };
    return { ok: true as const, path: outcome.path };
  };
  return { fn, calls };
}

function makeInsert(outcome: InsertOutcome) {
  const calls: Array<Record<string, unknown>> = [];
  const fn = async (row: Record<string, unknown>) => {
    calls.push(row);
    if (outcome.mode === 'throw') throw new Error(outcome.error);
    if (outcome.mode === 'fail') return { ok: false as const, error: outcome.error };
    return { ok: true as const };
  };
  return { fn, calls };
}

describe('submitGearReport', () => {
  test('valid report + photo → upload once, insert once with photo_path, all-ok result', async () => {
    const upload = makeUpload({ mode: 'ok', path: 'user-1/sess-1.jpg' });
    const insert = makeInsert({ mode: 'ok' });

    const res = await submitGearReport(
      { uploadPhoto: upload.fn, insertReport: insert.fn },
      {
        userId: 'user-1',
        bleSessionId: 'sess-1',
        stationId: 'station-9',
        gate: 2,
        kind: 'lost',
        message: 'left my shin guards',
        photoUri: 'file:///tmp/p.jpg',
      },
    );

    expect(res).toEqual({ ok: true, photoUploaded: true, photoFailed: false });
    expect(upload.calls).toHaveLength(1);
    expect(upload.calls[0]).toEqual({
      userId: 'user-1',
      bleSessionId: 'sess-1',
      fileUri: 'file:///tmp/p.jpg',
    });
    expect(insert.calls).toHaveLength(1);
    expect(insert.calls[0].photo_path).toBe('user-1/sess-1.jpg');
    expect(insert.calls[0]).toMatchObject({
      user_id: 'user-1',
      kind: 'lost',
      status: 'open',
      ble_session_id: 'sess-1',
      station_id: 'station-9',
      gate: 2,
    });
  });

  test('photo upload FAILS (ok:false) → still inserts, NO photo_path, photoFailed flagged', async () => {
    const upload = makeUpload({ mode: 'fail', error: 'storage_down' });
    const insert = makeInsert({ mode: 'ok' });

    const res = await submitGearReport(
      { uploadPhoto: upload.fn, insertReport: insert.fn },
      { userId: 'user-1', bleSessionId: 'sess-1', kind: 'damaged', photoUri: 'file:///tmp/p.jpg' },
    );

    expect(res).toEqual({ ok: true, photoUploaded: false, photoFailed: true });
    expect(upload.calls).toHaveLength(1);
    expect(insert.calls).toHaveLength(1);
    expect(insert.calls[0]).not.toHaveProperty('photo_path');
  });

  test('photo upload THROWS → best-effort, still inserts, photoFailed flagged', async () => {
    const upload = makeUpload({ mode: 'throw', error: 'boom' });
    const insert = makeInsert({ mode: 'ok' });

    const res = await submitGearReport(
      { uploadPhoto: upload.fn, insertReport: insert.fn },
      { userId: 'user-1', bleSessionId: 'sess-1', kind: 'other', photoUri: 'file:///tmp/p.jpg' },
    );

    expect(res).toEqual({ ok: true, photoUploaded: false, photoFailed: true });
    expect(upload.calls).toHaveLength(1);
    expect(insert.calls).toHaveLength(1);
    expect(insert.calls[0]).not.toHaveProperty('photo_path');
  });

  test('invalid kind → NO upload, NO insert, {ok:false, invalid_kind}', async () => {
    const upload = makeUpload({ mode: 'ok', path: 'x' });
    const insert = makeInsert({ mode: 'ok' });

    const res = await submitGearReport(
      { uploadPhoto: upload.fn, insertReport: insert.fn },
      { userId: 'user-1', bleSessionId: 'sess-1', kind: 'nonsense', photoUri: 'file:///tmp/p.jpg' },
    );

    expect(res).toEqual({ ok: false, error: 'invalid_kind' });
    expect(upload.calls).toHaveLength(1); // upload is best-effort and runs first
    expect(insert.calls).toHaveLength(0); // guarded: no insert on invalid kind
  });

  test('empty userId → NO insert, {ok:false}', async () => {
    const upload = makeUpload({ mode: 'ok', path: 'x' });
    const insert = makeInsert({ mode: 'ok' });

    const res = await submitGearReport(
      { uploadPhoto: upload.fn, insertReport: insert.fn },
      { userId: '   ', kind: 'lost' },
    );

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('missing_user_id');
    expect(insert.calls).toHaveLength(0);
  });

  test('no photo → no upload, insert once (no photo_path)', async () => {
    const upload = makeUpload({ mode: 'ok', path: 'x' });
    const insert = makeInsert({ mode: 'ok' });

    const res = await submitGearReport(
      { uploadPhoto: upload.fn, insertReport: insert.fn },
      { userId: 'user-1', bleSessionId: 'sess-1', kind: 'wrong_item', message: 'got someone elses' },
    );

    expect(res).toEqual({ ok: true, photoUploaded: false, photoFailed: false });
    expect(upload.calls).toHaveLength(0);
    expect(insert.calls).toHaveLength(1);
    expect(insert.calls[0]).not.toHaveProperty('photo_path');
  });

  test('photoUri set but bleSessionId absent → no upload (cannot key path), insert once', async () => {
    const upload = makeUpload({ mode: 'ok', path: 'x' });
    const insert = makeInsert({ mode: 'ok' });

    const res = await submitGearReport(
      { uploadPhoto: upload.fn, insertReport: insert.fn },
      { userId: 'user-1', kind: 'lost', photoUri: 'file:///tmp/p.jpg' },
    );

    expect(res).toEqual({ ok: true, photoUploaded: false, photoFailed: false });
    expect(upload.calls).toHaveLength(0);
    expect(insert.calls).toHaveLength(1);
  });

  test('photoSessionId override → photo uploads under override, row ble_session_id untouched', async () => {
    const upload = makeUpload({ mode: 'ok', path: 'user-1/report-123.jpg' });
    const insert = makeInsert({ mode: 'ok' });

    const res = await submitGearReport(
      { uploadPhoto: upload.fn, insertReport: insert.fn },
      {
        userId: 'user-1',
        bleSessionId: null, // no real session
        photoSessionId: 'report-123', // synthesized key for the photo only
        kind: 'lost',
        photoUri: 'file:///tmp/p.jpg',
      },
    );

    expect(res).toEqual({ ok: true, photoUploaded: true, photoFailed: false });
    expect(upload.calls).toHaveLength(1);
    expect(upload.calls[0].bleSessionId).toBe('report-123');
    expect(insert.calls).toHaveLength(1);
    // synthesized id must NOT leak into the row's ble_session_id
    expect(insert.calls[0]).not.toHaveProperty('ble_session_id');
    expect(insert.calls[0].photo_path).toBe('user-1/report-123.jpg');
  });

  test('insert FAILS → {ok:false, error} propagated', async () => {
    const upload = makeUpload({ mode: 'ok', path: 'x' });
    const insert = makeInsert({ mode: 'fail', error: 'rls_denied' });

    const res = await submitGearReport(
      { uploadPhoto: upload.fn, insertReport: insert.fn },
      { userId: 'user-1', bleSessionId: 'sess-1', kind: 'lost' },
    );

    expect(res).toEqual({ ok: false, error: 'rls_denied' });
    expect(insert.calls).toHaveLength(1);
  });

  test('insert THROWS → {ok:false} (never throws out)', async () => {
    const upload = makeUpload({ mode: 'ok', path: 'x' });
    const insert = makeInsert({ mode: 'throw', error: 'network' });

    const res = await submitGearReport(
      { uploadPhoto: upload.fn, insertReport: insert.fn },
      { userId: 'user-1', bleSessionId: 'sess-1', kind: 'lost' },
    );

    expect(res.ok).toBe(false);
    expect(insert.calls).toHaveLength(1);
  });

  test('no uploadPhoto dep provided → no upload, insert once', async () => {
    const insert = makeInsert({ mode: 'ok' });

    const res = await submitGearReport(
      { insertReport: insert.fn },
      { userId: 'user-1', bleSessionId: 'sess-1', kind: 'lost', photoUri: 'file:///tmp/p.jpg' },
    );

    expect(res).toEqual({ ok: true, photoUploaded: false, photoFailed: false });
    expect(insert.calls).toHaveLength(1);
    expect(insert.calls[0]).not.toHaveProperty('photo_path');
  });
});
