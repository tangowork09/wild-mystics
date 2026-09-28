import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { api, randomIp, sha256Hex, signUp, uniqueName, UUID_RE } from './helpers';

describe('health, CORS and routing', () => {
  it('GET /api/health answers {ok:true} with CORS and no-store', async () => {
    const res = await api('/api/health', { headers: { Origin: 'https://wildmystics.example' } });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it.each(['capacitor://localhost', 'http://localhost:5180', 'http://192.168.1.20:5180', 'https://localhost'])(
    'answers the CORS preflight from %s',
    async (origin) => {
      const res = await api('/api/save', {
        method: 'OPTIONS',
        headers: {
          Origin: origin,
          'Access-Control-Request-Method': 'PUT',
          'Access-Control-Request-Headers': 'authorization,content-type',
        },
      });
      expect(res.status).toBe(204);
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
      expect(res.headers.get('Access-Control-Allow-Methods')).toContain('PUT');
      expect(res.headers.get('Access-Control-Allow-Headers')?.toLowerCase()).toContain('authorization');
      expect(res.headers.get('Access-Control-Max-Age')).toBe('86400');
    },
  );

  it('returns JSON 404s (with CORS headers) for unknown routes', async () => {
    const res = await api('/api/nope', { headers: { Origin: 'capacitor://localhost' } });
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: 'not_found' });
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });
});

describe('POST /api/auth/signup', () => {
  it('creates an account and returns {token, user}; stores only a PBKDF2 hash and SHA-256(token)', async () => {
    const username = uniqueName('Mystic');
    const res = await api('/api/auth/signup', {
      json: { username, email: ` ${username}@Example.com `, password: 'correct horse battery' },
    });
    expect(res.status).toBe(201);
    const { token, user } = res.body;
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(user).toEqual({ id: expect.stringMatching(UUID_RE), username, email: `${username}@Example.com`, createdAt: expect.any(Number) });
    expect(Math.abs(user.createdAt - Date.now())).toBeLessThan(60_000);

    const row = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(user.id).first<Record<string, any>>();
    expect(row!.pass_hash).toMatch(/^pbkdf2_sha256\$100000\$[A-Za-z0-9+/]{43}=$/);
    expect(atob(row!.salt)).toHaveLength(16);
    expect(JSON.stringify(row)).not.toContain('correct horse');

    const sessions = await env.DB.prepare('SELECT token_hash, created_at, expires_at FROM sessions WHERE user_id = ?')
      .bind(user.id)
      .all<{ token_hash: string; created_at: number; expires_at: number }>();
    expect(sessions.results).toHaveLength(1);
    expect(sessions.results[0]!.token_hash).toBe(await sha256Hex(token));
    expect(sessions.results[0]!.expires_at - sessions.results[0]!.created_at).toBe(30 * 24 * 60 * 60 * 1000);
  });

  it('treats a missing or blank email as null, and allows many accounts without email', async () => {
    const a = await api('/api/auth/signup', { json: { username: uniqueName(), password: 'longenough1' } });
    const b = await api('/api/auth/signup', { json: { username: uniqueName(), email: '   ', password: 'longenough1' } });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(a.body.user.email).toBeNull();
    expect(b.body.user.email).toBeNull();
  });

  it.each([
    [{ username: 'ab', password: 'longenough1' }, 'invalid', 'username'],
    [{ username: 'a'.repeat(21), password: 'longenough1' }, 'invalid', 'username'],
    [{ username: 'bad name', password: 'longenough1' }, 'invalid', 'username'],
    [{ username: 'bad-name', password: 'longenough1' }, 'invalid', 'username'],
    [{ username: 'bad@name', password: 'longenough1' }, 'invalid', 'username'],
    [{ password: 'longenough1' }, 'invalid', 'username'],
    [{ username: 'fine_name', email: 'not-an-email', password: 'longenough1' }, 'invalid', 'email'],
    [{ username: 'fine_name', email: 42, password: 'longenough1' }, 'invalid', 'email'],
    [{ username: 'fine_name', password: 'short' }, 'weak', 'password'],
    [{ username: 'fine_name', password: 'x'.repeat(257) }, 'invalid', 'password'],
    [{ username: 'fine_name' }, 'invalid', 'password'],
  ])('rejects %j with 400 %s (%s)', async (json, code, field) => {
    const res = await api('/api/auth/signup', { json });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code, field, error: expect.any(String) });
  });

  it('rejects non-JSON and non-object bodies with 400', async () => {
    for (const rawBody of ['not json', '[1,2]', 'null', '']) {
      const res = await api('/api/auth/signup', { method: 'POST', rawBody });
      expect(res.status, rawBody).toBe(400);
      expect(res.body.code).toBe('invalid');
    }
  });

  it('returns 409 for a duplicate username, ignoring case', async () => {
    const first = await signUp({ username: uniqueName('Case') });
    const res = await api('/api/auth/signup', {
      json: { username: first.user.username.toUpperCase(), password: 'longenough1' },
    });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'taken', field: 'username' });
  });

  it('returns 409 for a duplicate email, ignoring case', async () => {
    const email = `${uniqueName('mail')}@example.com`;
    await signUp({ email });
    const res = await api('/api/auth/signup', { json: { username: uniqueName(), email: email.toUpperCase(), password: 'longenough1' } });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'taken', field: 'email' });
  });
});

describe('POST /api/auth/login', () => {
  it('logs in by username (any case) or by email (any case); every login gets its own session', async () => {
    const email = `${uniqueName('who')}@example.com`;
    const acct = await signUp({ email, password: 'open sesame 123' });

    const byName = await api('/api/auth/login', { json: { login: acct.user.username.toUpperCase(), password: 'open sesame 123' } });
    expect(byName.status).toBe(200);
    expect(byName.body.user).toEqual(acct.user);
    expect(byName.body.token).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const byEmail = await api('/api/auth/login', { json: { login: ` ${email.toUpperCase()} `, password: 'open sesame 123' } });
    expect(byEmail.status).toBe(200);
    expect(byEmail.body.user.id).toBe(acct.user.id);

    const tokens = new Set([acct.token, byName.body.token, byEmail.body.token]);
    expect(tokens.size).toBe(3);
    const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?').bind(acct.user.id).first<number>('n');
    expect(count).toBe(3);
  });

  it('answers 401 with the same generic message for a wrong password and an unknown account', async () => {
    const acct = await signUp();
    const wrong = await api('/api/auth/login', { json: { login: acct.user.username, password: 'wrong password' } });
    const unknown = await api('/api/auth/login', { json: { login: uniqueName('ghost'), password: 'whatever123' } });
    const unknownEmail = await api('/api/auth/login', { json: { login: 'ghost@example.com', password: 'whatever123' } });
    for (const res of [wrong, unknown, unknownEmail]) {
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: 'Incorrect username/email or password.', code: 'unauthorized' });
    }
  });

  it('validates the body', async () => {
    expect((await api('/api/auth/login', { json: { password: 'x' } })).status).toBe(400);
    expect((await api('/api/auth/login', { json: { login: 'someone' } })).status).toBe(400);
    expect((await api('/api/auth/login', { method: 'POST', rawBody: '{oops' })).status).toBe(400);
  });

  it('throttles an IP after 10 failed logins (even with the right password); other IPs are unaffected', async () => {
    const acct = await signUp({ password: 'right password 1' });
    const ip = randomIp();
    for (let i = 0; i < 10; i++) {
      const res = await api('/api/auth/login', { json: { login: acct.user.username, password: `wrong ${i}` }, ip });
      expect(res.status).toBe(401);
    }
    const blocked = await api('/api/auth/login', { json: { login: acct.user.username, password: 'right password 1' }, ip });
    expect(blocked.status).toBe(429);
    expect(blocked.body).toMatchObject({ code: 'rate_limited', retryAfter: expect.any(Number) });
    expect(Number(blocked.headers.get('Retry-After'))).toBeGreaterThan(14 * 60);
    expect(blocked.headers.get('Access-Control-Allow-Origin')).toBe('*');

    const elsewhere = await api('/api/auth/login', { json: { login: acct.user.username, password: 'right password 1' }, ip: randomIp() });
    expect(elsewhere.status).toBe(200);

    // Once the window has passed, the IP may try again.
    await env.DB.prepare('UPDATE rate_limits SET window_start = window_start - ? WHERE bucket = ?')
      .bind(16 * 60 * 1000, `login:${ip}`)
      .run();
    const later = await api('/api/auth/login', { json: { login: acct.user.username, password: 'right password 1' }, ip });
    expect(later.status).toBe(200);
  });

  it('groups IPv6 clients by /64 for throttling', async () => {
    const acct = await signUp();
    for (let i = 0; i < 10; i++) {
      const res = await api('/api/auth/login', { json: { login: acct.user.username, password: 'nope nope' }, ip: `2001:db8:aa:bb::${i + 1}` });
      expect(res.status).toBe(401);
    }
    const sameNet = await api('/api/auth/login', { json: { login: acct.user.username, password: acct.password }, ip: '2001:0db8:00aa:00bb:1234::9' });
    expect(sameNet.status).toBe(429);
    const otherNet = await api('/api/auth/login', { json: { login: acct.user.username, password: acct.password }, ip: '2001:db8:aa:cc::1' });
    expect(otherNet.status).toBe(200);
  });
});

describe('signup throttle', () => {
  it('allows 20 new accounts per IP per hour, then 429', async () => {
    const ip = randomIp();
    for (let i = 0; i < 20; i++) await signUp({ ip });
    const res = await api('/api/auth/signup', { json: { username: uniqueName(), password: 'longenough1' }, ip });
    expect(res.status).toBe(429);
    expect(res.body.code).toBe('rate_limited');
  });
});

describe('GET /api/me and POST /api/auth/logout', () => {
  it('returns the user for a valid Bearer token and 401 otherwise', async () => {
    const acct = await signUp({ email: `${uniqueName('me')}@example.com` });
    const me = await api('/api/me', { token: acct.token });
    expect(me.status).toBe(200);
    expect(me.body).toEqual({ user: acct.user });

    const missing = await api('/api/me', { headers: { Origin: 'capacitor://localhost' } });
    expect(missing.status).toBe(401);
    expect(missing.body.code).toBe('unauthorized');
    expect(missing.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect((await api('/api/me', { token: 'A'.repeat(43) })).status).toBe(401);
    expect((await api('/api/me', { headers: { Authorization: `Basic ${acct.token}` } })).status).toBe(401);
  });

  it('logout deletes only the session it was called with', async () => {
    const acct = await signUp({ password: 'two devices 1' });
    const phone = await api('/api/auth/login', { json: { login: acct.user.username, password: 'two devices 1' } });

    const out = await api('/api/auth/logout', { method: 'POST', token: acct.token });
    expect(out.status).toBe(200);
    expect(out.body).toEqual({ ok: true });
    expect((await api('/api/me', { token: acct.token })).status).toBe(401);
    expect((await api('/api/save', { token: acct.token })).status).toBe(401);
    expect((await api('/api/me', { token: phone.body.token })).status).toBe(200);

    expect((await api('/api/auth/logout', { method: 'POST' })).status).toBe(401);
  });

  it('rejects and deletes expired sessions', async () => {
    const acct = await signUp();
    const tokenHash = await sha256Hex(acct.token);
    await env.DB.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?').bind(Date.now() - 1, tokenHash).run();
    const res = await api('/api/me', { token: acct.token });
    expect(res.status).toBe(401);
    const left = await env.DB.prepare('SELECT COUNT(*) AS n FROM sessions WHERE token_hash = ?').bind(tokenHash).first<number>('n');
    expect(left).toBe(0);
  });

  it('slides an active session forward to a fresh 30 days (at most daily)', async () => {
    const acct = await signUp();
    const tokenHash = await sha256Hex(acct.token);
    const day = 24 * 60 * 60 * 1000;
    await env.DB.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?').bind(Date.now() + 10 * day, tokenHash).run();
    expect((await api('/api/me', { token: acct.token })).status).toBe(200);
    const expires = await env.DB.prepare('SELECT expires_at FROM sessions WHERE token_hash = ?').bind(tokenHash).first<number>('expires_at');
    expect(expires! - Date.now()).toBeGreaterThan(29 * day);
  });
});
