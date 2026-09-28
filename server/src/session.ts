// Bearer-token sessions. The client holds the raw token; D1 holds only SHA-256(token).

import type { Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import { SESSION_RENEW_INTERVAL_MS, SESSION_TTL_MS } from './config';
import { newSessionToken, sha256Hex } from './crypto';
import type { AppEnv, PublicUser } from './types';

export function publicUser(row: { id: string; username: string; email: string | null; created_at: number }): PublicUser {
  return { id: row.id, username: row.username, email: row.email ?? null, createdAt: row.created_at };
}

/** Extracts the token from `Authorization: Bearer <token>`, or null if absent/malformed. */
export function bearerToken(header: string | undefined): string | null {
  const match = /^Bearer\s+([A-Za-z0-9_-]{16,128})\s*$/i.exec(header ?? '');
  return match ? match[1]! : null;
}

/** Statement that creates a fresh session row; returns the raw token for the client. */
export async function sessionInsert(db: D1Database, userId: string, now: number): Promise<{ token: string; stmt: D1PreparedStatement }> {
  const { token, tokenHash } = await newSessionToken();
  const stmt = db
    .prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .bind(tokenHash, userId, now, now + SESSION_TTL_MS);
  return { token, stmt };
}

export function unauthorized(c: Context<AppEnv>, message = 'Please sign in again.') {
  return c.json({ error: message, code: 'unauthorized' }, 401);
}

/** Resolves the bearer token to a user (sets c.var.user) or answers 401. */
export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  const token = bearerToken(c.req.header('Authorization'));
  if (!token) return unauthorized(c, 'Sign in required.');
  const tokenHash = await sha256Hex(token);
  const now = Date.now();
  const db = c.env.DB;
  const row = await db
    .prepare(
      `SELECT s.expires_at, u.id, u.username, u.email, u.created_at
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = ?`,
    )
    .bind(tokenHash)
    .first<{ expires_at: number; id: string; username: string; email: string | null; created_at: number }>();
  if (!row) return unauthorized(c, 'Your session has ended. Please sign in again.');
  if (row.expires_at <= now) {
    await db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(tokenHash).run();
    return unauthorized(c, 'Your session has expired. Please sign in again.');
  }
  if (row.expires_at - now < SESSION_TTL_MS - SESSION_RENEW_INTERVAL_MS) {
    await db.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?').bind(now + SESSION_TTL_MS, tokenHash).run();
  }
  c.set('user', publicUser(row));
  await next();
});
