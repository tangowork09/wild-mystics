// Input validation for the auth endpoints. The client (src/net/internal.ts) applies the
// same rules offline for local accounts; keep the two in sync.

export const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const EMAIL_MAX = 254;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 256;
const LOGIN_MAX = EMAIL_MAX;

export type Field = 'username' | 'email' | 'password' | 'login';

export type Invalid = { ok: false; code: 'invalid' | 'weak'; field: Field; message: string };
type Valid<T> = { ok: true; value: T };

const invalid = (field: Field, message: string, code: 'invalid' | 'weak' = 'invalid'): Invalid => ({ ok: false, code, field, message });

export function parseSignup(body: Record<string, unknown>): Valid<{ username: string; email: string | null; password: string }> | Invalid {
  const { username, email, password } = body;
  if (typeof username !== 'string' || !USERNAME_RE.test(username.trim())) {
    return invalid('username', 'Username must be 3-20 characters: letters, numbers or underscores.');
  }
  if (email !== undefined && email !== null && typeof email !== 'string') {
    return invalid('email', 'Email must be text.');
  }
  const cleanEmail = typeof email === 'string' ? email.trim() : '';
  if (cleanEmail && (cleanEmail.length > EMAIL_MAX || !EMAIL_RE.test(cleanEmail))) {
    return invalid('email', 'That email address doesn\'t look right.');
  }
  if (typeof password !== 'string') return invalid('password', 'Password is required.');
  if (password.length < PASSWORD_MIN) return invalid('password', `Password must be at least ${PASSWORD_MIN} characters.`, 'weak');
  if (password.length > PASSWORD_MAX) return invalid('password', `Password must be at most ${PASSWORD_MAX} characters.`);
  return { ok: true, value: { username: username.trim(), email: cleanEmail || null, password } };
}

export function parseLogin(body: Record<string, unknown>): Valid<{ login: string; password: string }> | Invalid {
  const { login, password } = body;
  const cleanLogin = typeof login === 'string' ? login.trim() : '';
  if (!cleanLogin || cleanLogin.length > LOGIN_MAX) return invalid('login', 'Enter your username or email.');
  if (typeof password !== 'string' || !password || password.length > PASSWORD_MAX) {
    return invalid('password', 'Enter your password.');
  }
  return { ok: true, value: { login: cleanLogin, password } };
}

/** Size of a string once stored as UTF-8 (what D1 counts against its row limit). */
export function utf8Length(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}
