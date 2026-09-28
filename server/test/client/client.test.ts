// Integration tests for the game client's net layer (../../../src/net) against this Worker.
// The client code runs unmodified inside workerd: global fetch is routed to the Worker under
// test, and each "device" gets its own in-memory localStorage.
// Not type-checked with the server tsconfig (the client targets DOM + Vite types); the client
// itself is type-checked from the repo root.

import { env, exports } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import * as net from '../../../src/net/auth';
import { pullSave, pushSave, saveKeyFor } from '../../../src/net/cloudsave';
import { hashPassword, pbkdf2Portable, pbkdf2Sha256, sha256Portable, verifyPassword } from '../../../src/net/crypto';

class MemoryStorage {
  private map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null;
  }
  getItem(k: string) {
    return this.map.has(k) ? this.map.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, String(v));
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
  clear() {
    this.map.clear();
  }
}

const worker = (exports as unknown as { default: Fetcher }).default;
let reachable = true;
let calls: string[] = [];
let deviceIp = '10.0.0.1';

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const req = new Request(input, init);
  calls.push(`${req.method} ${new URL(req.url).pathname}`);
  if (!reachable) throw new TypeError('Failed to fetch');
  const headers = new Headers(req.headers);
  headers.set('CF-Connecting-IP', deviceIp);
  return worker.fetch(new Request(req, { headers }));
}) as typeof fetch;

const g = globalThis as unknown as { localStorage: MemoryStorage };
let apiCounter = 0;

/** A fresh device: empty storage, new IP. */
function newDevice(): MemoryStorage {
  const storage = new MemoryStorage();
  g.localStorage = storage;
  const b = crypto.getRandomValues(new Uint8Array(3));
  deviceIp = `10.${b[0]}.${b[1]}.${b[2]}`;
  return storage;
}

/** Points this device at the API. A new base URL per call also resets the 60 s health cache. */
function useCloud(): string {
  const base = `https://api-${++apiCounter}.wild.test`;
  g.localStorage.setItem('wm-api-url', `${base}/`);
  return base;
}

const uname = () => `u_${[...crypto.getRandomValues(new Uint8Array(5))].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
const utf8 = (s: string) => new TextEncoder().encode(s);

async function expectAuthError(p: Promise<unknown>, code: string, field?: string) {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(net.AuthError);
  expect((err as net.AuthError).code).toBe(code);
  expect((err as net.AuthError).message.length).toBeGreaterThan(5);
  if (field) expect((err as net.AuthError).field).toBe(field);
}

beforeEach(() => {
  newDevice();
  reachable = true;
  calls = [];
});

describe('apiBase() and cloudAvailable()', () => {
  it('is null with nothing configured, honours and normalizes the wm-api-url override, and "off" forces local', async () => {
    expect(net.apiBase()).toBeNull();
    expect(await net.cloudAvailable()).toBe(false);
    expect(calls).toEqual([]);
    g.localStorage.setItem('wm-api-url', ' https://api.example.com/api/ ');
    expect(net.apiBase()).toBe('https://api.example.com');
    g.localStorage.setItem('wm-api-url', 'http://localhost:8787');
    expect(net.apiBase()).toBe('http://localhost:8787');
    g.localStorage.setItem('wm-api-url', 'off');
    expect(net.apiBase()).toBeNull();
    g.localStorage.setItem('wm-api-url', 'not a url');
    expect(net.apiBase()).toBeNull();
  });

  it('checks /api/health once and caches the answer', async () => {
    useCloud();
    expect(await Promise.all([net.cloudAvailable(), net.cloudAvailable()])).toEqual([true, true]);
    expect(await net.cloudAvailable()).toBe(true);
    expect(calls).toEqual(['GET /api/health']);
  });

  it('is false when the server cannot be reached', async () => {
    useCloud();
    reachable = false;
    expect(await net.cloudAvailable()).toBe(false);
  });

  it('signup re-checks a cached "down" instead of silently creating a local account', async () => {
    useCloud();
    reachable = false;
    expect(await net.cloudAvailable()).toBe(false); // booted offline
    reachable = true; // network is back within the 60 s cache window
    expect(await net.cloudAvailable()).toBe(false); // the public check still answers from cache
    const acct = await net.signup(uname(), '', 'back-online-1');
    expect(acct.mode).toBe('cloud');
    expect(await net.cloudAvailable()).toBe(true);
  });
});

describe('cloud accounts', () => {
  it('signup creates a cloud account, stores the token in wm-session and becomes currentAccount()', async () => {
    useCloud();
    const name = uname();
    const acct = await net.signup(name, `${name}@Example.com`, 'dragonfire9');
    expect(acct).toEqual({ id: expect.any(String), username: name, email: `${name}@Example.com`, createdAt: expect.any(Number), mode: 'cloud' });
    expect(net.currentAccount()).toEqual(acct);
    const session = JSON.parse(g.localStorage.getItem('wm-session')!);
    expect(session).toMatchObject({ mode: 'cloud', token: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/), account: { id: acct.id } });
    const row = await env.DB.prepare('SELECT username FROM users WHERE id = ?').bind(acct.id).first<string>('username');
    expect(row).toBe(name);

    const noEmail = await net.signup(uname(), '', 'dragonfire9');
    expect(noEmail.email).toBeUndefined();
    expect('email' in noEmail).toBe(false);
  });

  it('maps server and validation failures onto AuthError codes', async () => {
    useCloud();
    const name = uname();
    await net.signup(name, '', 'dragonfire9');
    await expectAuthError(net.signup(name.toUpperCase(), '', 'dragonfire9'), 'taken', 'username');
    calls = [];
    await expectAuthError(net.signup('x', '', 'dragonfire9'), 'invalid', 'username');
    await expectAuthError(net.signup('valid_name', 'nope', 'dragonfire9'), 'invalid', 'email');
    await expectAuthError(net.signup('valid_name', '', 'short'), 'weak', 'password');
    await expectAuthError(net.login('', 'x'), 'invalid', 'login');
    expect(calls).toEqual([]); // rejected before any request
  });

  it('logs in by email or username and rejects a wrong password', async () => {
    useCloud();
    const name = uname();
    const created = await net.signup(name, `${name}@example.com`, 'moonlit-grove');
    await net.logout();
    expect(net.currentAccount()).toBeNull();

    const byEmail = await net.login(`${name.toUpperCase()}@EXAMPLE.COM`, 'moonlit-grove');
    expect(byEmail).toEqual(created);
    await expectAuthError(net.login(name, 'wrong-password'), 'unauthorized');
    expect(net.currentAccount()).toEqual(created); // a failed login leaves the session alone
  });

  it('restoreSession(): validates the token, signs out on 401, and trusts the cached account offline', async () => {
    useCloud();
    const acct = await net.signup(uname(), '', 'restore-me-1');
    expect(await net.restoreSession()).toEqual(acct);

    reachable = false;
    expect(await net.restoreSession()).toEqual(acct);
    expect(net.currentAccount()).toEqual(acct);

    reachable = true;
    await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(acct.id).run();
    expect(await net.restoreSession()).toBeNull();
    expect(net.currentAccount()).toBeNull();
    expect(g.localStorage.getItem('wm-session')).toBeNull();
  });

  it('logout() clears the device session and revokes it on the server', async () => {
    useCloud();
    const acct = await net.signup(uname(), '', 'bye-bye-123');
    const token = JSON.parse(g.localStorage.getItem('wm-session')!).token as string;
    await net.logout();
    expect(net.currentAccount()).toBeNull();
    const res = await worker.fetch('https://x/api/me', { headers: { Authorization: `Bearer ${token}` } });
    expect(res.status).toBe(401);
    expect(acct.mode).toBe('cloud');
  });
});

describe('local accounts', () => {
  it('without an API: signup/login stay on the device, hashed with PBKDF2', async () => {
    const acct = await net.signup('Local_Hero', 'hero@example.com', 'offline-pass');
    expect(acct).toMatchObject({ username: 'Local_Hero', email: 'hero@example.com', mode: 'local' });
    expect(calls).toEqual([]);

    const stored = g.localStorage.getItem('wm-accounts')!;
    expect(stored).not.toContain('offline-pass');
    const [record] = JSON.parse(stored);
    expect(record.hash).toMatch(/^pbkdf2_sha256\$100000\$/);
    expect(atob(record.salt)).toHaveLength(16);

    await net.logout();
    expect(await net.login('local_hero', 'offline-pass')).toEqual(acct);
    await net.logout();
    expect(await net.login('HERO@example.com', 'offline-pass')).toEqual(acct);
    await expectAuthError(net.login('Local_Hero', 'nope-nope-nope'), 'unauthorized');
    await expectAuthError(net.login('nobody', 'whatever1'), 'unauthorized');
    await expectAuthError(net.signup('LOCAL_HERO', '', 'another-pass'), 'taken', 'username');
    await expectAuthError(net.signup('other_hero', 'Hero@Example.com', 'another-pass'), 'taken', 'email');
    expect(await net.restoreSession()).toEqual(acct);
    expect(net.listLocalProfiles()).toEqual([acct]);
  });

  it('falls back to a local account when the API is configured but unreachable', async () => {
    useCloud();
    reachable = false;
    const acct = await net.signup('Offline_Oak', '', 'offline-pass');
    expect(acct.mode).toBe('local');
    await net.logout();
    expect((await net.login('offline_oak', 'offline-pass')).id).toBe(acct.id);
    await net.logout();
    // An unknown name while the server is down is probably a cloud account: say so.
    await expectAuthError(net.login('cloud_only_user', 'whatever1'), 'network');
  });

  it('still signs local accounts in once the cloud is reachable', async () => {
    const local = await net.signup('Hearth_Keeper', '', 'my-local-pass');
    await net.logout();
    useCloud();
    const back = await net.login('hearth_keeper', 'my-local-pass');
    expect(back).toEqual(local);
    expect(calls).toContain('POST /api/auth/login');
  });

  it('playAsGuest() creates one Wayfarer profile per device and reuses it', async () => {
    const guest = await net.playAsGuest();
    expect(guest).toMatchObject({ mode: 'guest', username: expect.stringMatching(/^Wayfarer-\d{4}$/) });
    expect(net.currentAccount()).toEqual(guest);
    await net.logout();
    expect(net.currentAccount()).toBeNull();
    expect(await net.playAsGuest()).toEqual(guest);
    expect(await net.restoreSession()).toEqual(guest);
    expect(net.listLocalProfiles()).toEqual([guest]);
    expect(saveKeyFor(guest)).toBe(`wm-save-${guest.id}`);
    expect(saveKeyFor(null)).toBe('wm-save-guest');
  });
});

describe('cloud saves', () => {
  it('local and guest accounts never sync', async () => {
    await net.playAsGuest();
    expect(await pullSave()).toBeNull();
    expect(await pushSave('{}')).toEqual({ ok: false, offline: true });
    expect(calls).toEqual([]);
  });

  it('pull (none) -> push -> pull round-trips and tracks the version per account', async () => {
    useCloud();
    const acct = await net.signup(uname(), '', 'save-flow-1');
    expect(await pullSave()).toBeNull();
    expect(g.localStorage.getItem(`wm-save-version-${acct.id}`)).toBe('0');
    expect(await pushSave('{"lv":1}')).toEqual({ ok: true, version: 1 });
    expect(await pushSave('{"lv":2}')).toEqual({ ok: true, version: 2 });
    expect(g.localStorage.getItem(`wm-save-version-${acct.id}`)).toBe('2');
    expect(await pullSave()).toEqual({ data: '{"lv":2}', version: 2, updatedAt: expect.any(Number) });
  });

  it('detects a conflict between two devices and resolves "keep mine" via pullSave + pushSave', async () => {
    const laptop = newDevice();
    const base = useCloud();
    const name = uname();
    await net.signup(name, '', 'two-devices-1');
    expect(await pushSave('laptop v1')).toEqual({ ok: true, version: 1 });

    newDevice();
    g.localStorage.setItem('wm-api-url', base);
    await net.login(name, 'two-devices-1');
    expect((await pullSave())?.data).toBe('laptop v1');
    expect(await pushSave('phone v2')).toEqual({ ok: true, version: 2 });

    g.localStorage = laptop;
    const conflict = await pushSave('laptop v2');
    expect(conflict).toEqual({ ok: false, conflict: true, remoteVersion: 2, remoteUpdatedAt: expect.any(Number) });
    expect(await pushSave('laptop v2')).toMatchObject({ conflict: true }); // still conflicting until resolved

    expect((await pullSave())?.data).toBe('phone v2'); // adopt the remote version as base...
    expect(await pushSave('laptop v2')).toEqual({ ok: true, version: 3 }); // ...then overwrite it
  });

  it('serializes overlapping pushes so they do not conflict with each other', async () => {
    useCloud();
    await net.signup(uname(), '', 'overlap-123');
    const results = await Promise.all([pushSave('a'), pushSave('b'), pushSave('c')]);
    expect(results).toEqual([
      { ok: true, version: 1 },
      { ok: true, version: 2 },
      { ok: true, version: 3 },
    ]);
    expect((await pullSave())?.data).toBe('c');
  });

  it('reports offline without touching the known version when the server is unreachable', async () => {
    useCloud();
    const acct = await net.signup(uname(), '', 'offline-save-1');
    await pushSave('v1');
    reachable = false;
    expect(await pushSave('v2')).toEqual({ ok: false, offline: true });
    expect(await pullSave()).toBeNull();
    expect(g.localStorage.getItem(`wm-save-version-${acct.id}`)).toBe('1');
    reachable = true;
    expect(await pushSave('v2')).toEqual({ ok: true, version: 2 });
  });

  it('throws AuthError for oversized saves (no request) and for ended sessions', async () => {
    useCloud();
    const acct = await net.signup(uname(), '', 'limits-123');
    calls = [];
    await expectAuthError(pushSave('x'.repeat(1_990_001)), 'invalid');
    expect(calls).toEqual([]);
    await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(acct.id).run();
    await expectAuthError(pushSave('fine'), 'unauthorized');
    await expectAuthError(pullSave(), 'unauthorized');
  });
});

describe('local password hashing', () => {
  it('portable SHA-256 and PBKDF2 match published vectors', () => {
    expect(hex(sha256Portable(utf8('')))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(hex(sha256Portable(utf8('abc')))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(hex(sha256Portable(utf8('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')))).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    );
    expect(hex(pbkdf2Portable(utf8('password'), utf8('salt'), 1, 32))).toBe('120fb6cffcf8b32c43e7225256c4f837a86548c92ccc35480805987cb70be17b');
    expect(hex(pbkdf2Portable(utf8('password'), utf8('salt'), 2, 32))).toBe('ae4d0c95af6b46d32d0adff928f06dd02a303f8ef3c251dfd6e2d85a95474c43');
    expect(hex(pbkdf2Portable(utf8('password'), utf8('salt'), 4096, 32))).toBe('c5e478d59288c841aa530db6845c4c8d962893a001ce4e11a4963873aa98134a');
    expect(hex(pbkdf2Portable(utf8('passwd'), utf8('salt'), 1, 64))).toBe(
      '55ac046e56e3089fec1691c22544b605f94185216dde0465e68b9d57c20dacbc49ca9cccf179b645991664b39d77ef317c71b845b1e30bd509112041d3a19783',
    );
  });

  it('portable PBKDF2 equals WebCrypto (long passwords, odd lengths, 100k iterations)', async () => {
    const cases: [string, number, number][] = [
      ['short', 1000, 32],
      ['p'.repeat(64), 3, 32],
      ['a much longer passphrase that exceeds one sixty-four byte HMAC block ✨', 777, 40],
      ['Wayfarer-4821 hunter2', 100_000, 32],
    ];
    for (const [password, iterations, length] of cases) {
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const expected = await pbkdf2Sha256(password, salt, iterations, length);
      expect(hex(pbkdf2Portable(utf8(password), salt, iterations, length))).toBe(hex(expected));
    }
  });

  it('hashPassword/verifyPassword round-trip and reject tampering', async () => {
    const { hash, salt } = await hashPassword('correct horse');
    expect(await verifyPassword('correct horse', hash, salt)).toBe(true);
    expect(await verifyPassword('correct horsE', hash, salt)).toBe(false);
    expect(await verifyPassword('correct horse', hash.replace('100000', '99999'), salt)).toBe(false);
    expect(await verifyPassword('correct horse', 'garbage', salt)).toBe(false);
  });
});
