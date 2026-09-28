import { describe, expect, it } from 'vitest';
import { MAX_BODY_BYTES, MAX_SAVE_BYTES } from '../src/config';
import { api, signUp } from './helpers';

const put = (token: string, data: unknown, baseVersion: unknown) =>
  api('/api/save', { method: 'PUT', token, json: { data, baseVersion } });

describe('cloud save', () => {
  it('404 before the first save, then create (baseVersion 0), read back, and bump versions', async () => {
    const { token } = await signUp();
    const none = await api('/api/save', { token });
    expect(none.status).toBe(404);
    expect(none.body.code).toBe('not_found');

    const first = await put(token, '{"team":["emberling"]}', 0);
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ version: 1, updatedAt: expect.any(Number) });

    const read = await api('/api/save', { token });
    expect(read.status).toBe(200);
    expect(read.body).toEqual({ data: '{"team":["emberling"]}', version: 1, updatedAt: first.body.updatedAt });

    const second = await put(token, '{"team":["emberling","gloop"]}', 1);
    expect(second.status).toBe(200);
    expect(second.body.version).toBe(2);
    expect(second.body.updatedAt).toBeGreaterThanOrEqual(first.body.updatedAt);
    expect((await api('/api/save', { token })).body.data).toBe('{"team":["emberling","gloop"]}');
  });

  it('409s a stale baseVersion with the current version and leaves the save untouched', async () => {
    const { token } = await signUp();
    await put(token, 'v1', 0);
    const v2 = await put(token, 'v2 from laptop', 1);
    expect(v2.body.version).toBe(2);

    const stale = await put(token, 'v2 from phone', 1);
    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({ conflict: true, version: 2, updatedAt: v2.body.updatedAt });

    const again = await put(token, 'first-save attempt from a third device', 0);
    expect(again.status).toBe(409);
    expect(again.body).toMatchObject({ conflict: true, version: 2 });

    const ahead = await put(token, 'from the future', 7);
    expect(ahead.status).toBe(409);

    expect((await api('/api/save', { token })).body).toMatchObject({ data: 'v2 from laptop', version: 2 });

    // "Keep mine": retry on top of the version the server reported.
    const resolved = await put(token, 'v2 from phone', stale.body.version);
    expect(resolved.status).toBe(200);
    expect(resolved.body.version).toBe(3);
  });

  it('409s with version 0 when there is no save but baseVersion > 0', async () => {
    const { token } = await signUp();
    const res = await put(token, 'data', 3);
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ conflict: true, version: 0, updatedAt: 0 });
  });

  it('lets exactly one of two devices win a race on the same baseVersion', async () => {
    const { token } = await signUp();
    await put(token, 'base', 0);
    const [a, b] = await Promise.all([put(token, 'device A', 1), put(token, 'device B', 1)]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const winner = a.status === 200 ? 'device A' : 'device B';
    expect((await api('/api/save', { token })).body).toMatchObject({ data: winner, version: 2 });
  });

  it('keeps saves private to each account', async () => {
    const alice = await signUp();
    const bob = await signUp();
    await put(alice.token, 'alice save', 0);
    expect((await api('/api/save', { token: bob.token })).status).toBe(404);
    expect((await put(bob.token, 'bob save', 0)).body.version).toBe(1);
    expect((await api('/api/save', { token: alice.token })).body.data).toBe('alice save');
  });

  it('requires a valid session', async () => {
    expect((await api('/api/save')).status).toBe(401);
    expect((await api('/api/save', { method: 'PUT', json: { data: 'x', baseVersion: 0 } })).status).toBe(401);
  });

  it.each([
    [{ data: 42, baseVersion: 0 }],
    [{ data: null, baseVersion: 0 }],
    [{ data: 'x' }],
    [{ data: 'x', baseVersion: -1 }],
    [{ data: 'x', baseVersion: 1.5 }],
    [{ data: 'x', baseVersion: '0' }],
  ])('rejects malformed save body %j with 400', async (json) => {
    const { token } = await signUp();
    const res = await api('/api/save', { method: 'PUT', token, json });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid');
  });

  it(`accepts a save of exactly ${MAX_SAVE_BYTES} UTF-8 bytes (JSON-heavy) and returns it byte-for-byte`, async () => {
    const { token } = await signUp();
    const creatures = Array.from({ length: 25_000 }, (_, i) => ({ uid: `c${i}`, species: 'emberling', nick: 'Émber ✨', hp: i % 97 }));
    let data = JSON.stringify({ version: 1, box: creatures });
    const bytes = new TextEncoder().encode(data).byteLength;
    expect(bytes).toBeLessThan(MAX_SAVE_BYTES);
    data += ' '.repeat(MAX_SAVE_BYTES - bytes);
    expect(new TextEncoder().encode(data).byteLength).toBe(MAX_SAVE_BYTES);

    const res = await put(token, data, 0);
    expect(res.status).toBe(200);
    const back = await api('/api/save', { token });
    expect(back.status).toBe(200);
    expect(back.body.data === data).toBe(true);
  });

  it('413s a save one byte over the limit (multi-byte characters counted in UTF-8)', async () => {
    const { token } = await signUp();
    const data = 'é'.repeat(MAX_SAVE_BYTES / 2) + 'x'; // 2 bytes per 'é'
    const res = await put(token, data, 0);
    expect(res.status).toBe(413);
    expect(res.body.code).toBe('too_large');
    expect((await api('/api/save', { token })).status).toBe(404);
  });

  it('413s any request body over 2.5 MB before parsing it, with CORS headers', async () => {
    const { token } = await signUp();
    const rawBody = JSON.stringify({ data: 'a'.repeat(MAX_BODY_BYTES), baseVersion: 0 });
    const res = await api('/api/save', {
      method: 'PUT',
      token,
      rawBody,
      headers: { 'Content-Type': 'application/json', Origin: 'capacitor://localhost' },
    });
    expect(res.status).toBe(413);
    expect(res.body.code).toBe('too_large');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');

    const signupFlood = await api('/api/auth/signup', { method: 'POST', rawBody });
    expect(signupFlood.status).toBe(413);
  });
});
