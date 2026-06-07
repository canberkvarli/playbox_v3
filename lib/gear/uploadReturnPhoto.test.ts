import { uploadReturnPhoto } from './uploadReturnPhoto';

/**
 * Only the pure-ish branches are unit-testable here. The actual file read +
 * storage round-trip needs a device/Expo runtime, so we cover:
 *  - the bad-path guard (empty/traversal ids) short-circuits BEFORE any I/O
 *  - the storage client is never touched when the path is rejected
 */
describe('uploadReturnPhoto — bad path guard', () => {
  function mockSupabase() {
    const upload = jest.fn();
    return {
      client: { storage: { from: () => ({ upload }) } } as any,
      upload,
    };
  }

  it('returns bad_path for an empty user id and never calls storage', async () => {
    const { client, upload } = mockSupabase();
    const res = await uploadReturnPhoto(client, '', 'sess-1', 'file:///x.jpg');
    expect(res).toEqual({ ok: false, error: 'bad_path' });
    expect(upload).not.toHaveBeenCalled();
  });

  it('returns bad_path for a traversal-y ble session id', async () => {
    const { client, upload } = mockSupabase();
    const res = await uploadReturnPhoto(client, 'user-1', '../evil', 'file:///x.jpg');
    expect(res).toEqual({ ok: false, error: 'bad_path' });
    expect(upload).not.toHaveBeenCalled();
  });

  it('never throws even if the storage client throws', async () => {
    const client = {
      storage: {
        from: () => ({
          upload: () => {
            throw new Error('boom');
          },
        }),
      },
    } as any;
    // data: URI avoids any fetch; exercises the catch path.
    const res = await uploadReturnPhoto(client, 'user-1', 'sess-1', 'data:image/jpeg;base64,AAAA');
    expect(res.ok).toBe(false);
  });
});
