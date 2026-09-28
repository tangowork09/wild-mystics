// Wild Mystics API: accounts + cloud saves on Cloudflare Workers + D1.
//
// All bodies are JSON. Errors are { error: string (safe to show players), code: ErrorCode, field? }.
//   GET  /api/health                                         -> { ok: true }
//   POST /api/auth/signup { username, email?, password }     -> 201 { token, user } | 400 | 409 taken | 429
//   POST /api/auth/login  { login, password }                -> { token, user } | 400 | 401 | 429
//   POST /api/auth/logout (Bearer)                           -> { ok: true }
//   GET  /api/me          (Bearer)                           -> { user }
//   GET  /api/save        (Bearer)                           -> { data, version, updatedAt } | 404
//   PUT  /api/save        (Bearer) { data, baseVersion }     -> { version, updatedAt }
//                                                              | 409 { conflict: true, version, updatedAt }
// user = { id, username, email: string | null, createdAt }; timestamps are epoch milliseconds.

import { Hono } from 'hono';
import type { Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import {
  LOGIN_MAX_FAILURES,
  LOGIN_WINDOW_MS,
  MAX_BODY_BYTES,
  MAX_SAVE_BYTES,
  SIGNUP_MAX,
  SIGNUP_WINDOW_MS,
} from './config';
import { burnPasswordCheck, hashPassword, sha256Hex, verifyPassword } from './crypto';
import { bearerToken, publicUser, requireAuth, sessionInsert, unauthorized } from './session';
import { clientKey, recordHit, retryAfterSeconds } from './throttle';
import type { AppEnv, UserRow } from './types';
import { parseLogin, parseSignup, utf8Length } from './validate';

const app = new Hono<AppEnv>();

// Bearer tokens (never cookies) make a wildcard origin safe, and it covers the web build,
// http://localhost:*, capacitor://localhost and the Android WebView alike.
app.use(
  '*',
  cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'PUT'],
    allowHeaders: ['Content-Type', 'Authorization'],
    exposeHeaders: ['Retry-After'],
    maxAge: 86400,
  }),
);
app.use('*', async (c, next) => {
  await next();
  c.header('Cache-Control', 'no-store');
});
app.use(
  '*',
  bodyLimit({
    maxSize: MAX_BODY_BYTES,
    onError: (c) => c.json({ error: 'That request is too large.', code: 'too_large' }, 413),
  }),
);

async function readJsonObject(c: Context<AppEnv>): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await c.req.json();
    return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const badJson = (c: Context<AppEnv>) => c.json({ error: 'Request body must be a JSON object.', code: 'invalid' }, 400);

function tooManyRequests(c: Context<AppEnv>, retryAfter: number, message: string) {
  c.header('Retry-After', String(retryAfter));
  return c.json({ error: message, code: 'rate_limited', retryAfter }, 429);
}

function taken(c: Context<AppEnv>, field: 'username' | 'email') {
  const error = field === 'username' ? 'That username is already taken.' : 'An account with that email already exists.';
  return c.json({ error, code: 'taken', field }, 409);
}

function uniqueViolation(err: unknown): 'username' | 'email' | null {
  const message = err instanceof Error ? err.message : String(err);
  if (/UNIQUE constraint failed: users\.username/i.test(message)) return 'username';
  if (/UNIQUE constraint failed: users\.email/i.test(message)) return 'email';
  return null;
}

const waitText = (seconds: number) => {
  const minutes = Math.ceil(seconds / 60);
  return minutes <= 1 ? 'a minute' : `${minutes} minutes`;
};

app.get('/api/health', (c) => c.json({ ok: true }));

app.post('/api/auth/signup', async (c) => {
  const db = c.env.DB;
  const now = Date.now();
  const body = await readJsonObject(c);
  if (!body) return badJson(c);
  const parsed = parseSignup(body);
  if (!parsed.ok) return c.json({ error: parsed.message, code: parsed.code, field: parsed.field }, 400);
  const { username, email, password } = parsed.value;

  const bucket = `signup:${clientKey(c.req.raw)}`;
  const wait = await retryAfterSeconds(db, bucket, SIGNUP_MAX, SIGNUP_WINDOW_MS, now);
  if (wait) return tooManyRequests(c, wait, `Too many new accounts from this network. Try again in ${waitText(wait)}.`);

  const { results: clashes } = await db
    .prepare('SELECT username FROM users WHERE username = ?1 OR (?2 IS NOT NULL AND email = ?2) LIMIT 2')
    .bind(username, email)
    .all<{ username: string }>();
  if (clashes.some((row) => row.username.toLowerCase() === username.toLowerCase())) return taken(c, 'username');
  if (clashes.length > 0) return taken(c, 'email');

  await recordHit(db, bucket, SIGNUP_WINDOW_MS, now);
  const { passHash, salt } = await hashPassword(password);
  const id = crypto.randomUUID();
  const session = await sessionInsert(db, id, now);
  try {
    await db.batch([
      db
        .prepare('INSERT INTO users (id, username, email, pass_hash, salt, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(id, username, email, passHash, salt, now),
      session.stmt,
    ]);
  } catch (err) {
    const field = uniqueViolation(err); // lost a race with a concurrent signup
    if (field) return taken(c, field);
    throw err;
  }
  return c.json({ token: session.token, user: { id, username, email, createdAt: now } }, 201);
});

app.post('/api/auth/login', async (c) => {
  const db = c.env.DB;
  const now = Date.now();
  const bucket = `login:${clientKey(c.req.raw)}`;
  const wait = await retryAfterSeconds(db, bucket, LOGIN_MAX_FAILURES, LOGIN_WINDOW_MS, now);
  if (wait) return tooManyRequests(c, wait, `Too many failed sign-in attempts. Try again in ${waitText(wait)}.`);

  const body = await readJsonObject(c);
  if (!body) return badJson(c);
  const parsed = parseLogin(body);
  if (!parsed.ok) return c.json({ error: parsed.message, code: parsed.code, field: parsed.field }, 400);
  const { login, password } = parsed.value;

  // Usernames can't contain '@', so an '@' means the player typed their email.
  const column = login.includes('@') ? 'email' : 'username';
  const user = await db
    .prepare(`SELECT id, username, email, pass_hash, salt, created_at FROM users WHERE ${column} = ?`)
    .bind(login)
    .first<UserRow>();
  let ok = false;
  if (user) ok = await verifyPassword(password, user.pass_hash, user.salt);
  else await burnPasswordCheck(password);
  if (!user || !ok) {
    await recordHit(db, bucket, LOGIN_WINDOW_MS, now);
    return c.json({ error: 'Incorrect username/email or password.', code: 'unauthorized' }, 401);
  }

  const session = await sessionInsert(db, user.id, now);
  await db.batch([
    session.stmt,
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND expires_at <= ?').bind(user.id, now),
  ]);
  return c.json({ token: session.token, user: publicUser(user) });
});

app.post('/api/auth/logout', async (c) => {
  const token = bearerToken(c.req.header('Authorization'));
  if (!token) return unauthorized(c, 'Sign in required.');
  await c.env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256Hex(token)).run();
  return c.json({ ok: true });
});

app.get('/api/me', requireAuth, (c) => c.json({ user: c.get('user') }));

app.get('/api/save', requireAuth, async (c) => {
  const row = await c.env.DB.prepare('SELECT data, version, updated_at FROM saves WHERE user_id = ?')
    .bind(c.get('user').id)
    .first<{ data: string; version: number; updated_at: number }>();
  if (!row) return c.json({ error: 'No cloud save yet.', code: 'not_found' }, 404);
  return c.json({ data: row.data, version: row.version, updatedAt: row.updated_at });
});

app.put('/api/save', requireAuth, async (c) => {
  const body = await readJsonObject(c);
  if (!body) return badJson(c);
  const { data, baseVersion } = body;
  if (typeof data !== 'string') return c.json({ error: 'Save data must be a string.', code: 'invalid' }, 400);
  if (typeof baseVersion !== 'number' || !Number.isSafeInteger(baseVersion) || baseVersion < 0) {
    return c.json({ error: 'baseVersion must be a whole number (0 for the first save).', code: 'invalid' }, 400);
  }
  if (utf8Length(data) > MAX_SAVE_BYTES) {
    return c.json({ error: `Save is too large to sync (max ${MAX_SAVE_BYTES} bytes).`, code: 'too_large' }, 413);
  }

  const db = c.env.DB;
  const userId = c.get('user').id;
  const now = Date.now();
  // Compare-and-swap on version: each statement is atomic in D1, so two devices racing on
  // the same baseVersion can't both win.
  const written =
    baseVersion === 0
      ? await db
          .prepare(
            `INSERT INTO saves (user_id, data, version, updated_at) VALUES (?, ?, 1, ?)
             ON CONFLICT(user_id) DO NOTHING RETURNING version, updated_at`,
          )
          .bind(userId, data, now)
          .first<{ version: number; updated_at: number }>()
      : await db
          .prepare(
            `UPDATE saves SET data = ?, version = version + 1, updated_at = ?
              WHERE user_id = ? AND version = ? RETURNING version, updated_at`,
          )
          .bind(data, now, userId, baseVersion)
          .first<{ version: number; updated_at: number }>();
  if (written) return c.json({ version: written.version, updatedAt: written.updated_at });

  const current = await db
    .prepare('SELECT version, updated_at FROM saves WHERE user_id = ?')
    .bind(userId)
    .first<{ version: number; updated_at: number }>();
  return c.json(
    {
      conflict: true,
      version: current?.version ?? 0,
      updatedAt: current?.updated_at ?? 0,
      error: 'Your cloud save was changed on another device.',
      code: 'conflict',
    },
    409,
  );
});

app.notFound((c) => c.json({ error: 'Not found.', code: 'not_found' }, 404));

app.onError((err, c) => {
  console.error('Unhandled error', err);
  return c.json({ error: 'Something went wrong on our side. Please try again.', code: 'server' }, 500);
});

export default app;
