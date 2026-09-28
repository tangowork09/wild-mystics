// Password hashing and session tokens, on WebCrypto only.
//
// Stored password format: pass_hash = "pbkdf2_sha256$<iterations>$<base64 key>" with the
// salt (base64 of 16 random bytes) in its own column. Keeping the iteration count in the
// hash lets the work factor change later without invalidating existing accounts.

import { HASH_BYTES, PBKDF2_ITERATIONS, SALT_BYTES, TOKEN_BYTES } from './config';

const HASH_SCHEME = 'pbkdf2_sha256';
/** Production Workers reject PBKDF2 above this (see config.ts). */
const MAX_WORKERS_PBKDF2_ITERATIONS = 100_000;
const encoder = new TextEncoder();

export function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary);
}

export function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function toBase64Url(bytes: Uint8Array): string {
  return toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function toHex(bytes: Uint8Array): string {
  let hex = '';
  for (let i = 0; i < bytes.length; i++) hex += bytes[i]!.toString(16).padStart(2, '0');
  return hex;
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(text));
  return toHex(new Uint8Array(digest));
}

async function pbkdf2(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number, length: number): Promise<Uint8Array<ArrayBuffer>> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, length * 8);
  return new Uint8Array(bits);
}

/** Constant-time comparison (crypto.subtle.timingSafeEqual is a Workers extension). */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  return crypto.subtle.timingSafeEqual(a, b);
}

export async function hashPassword(password: string): Promise<{ passHash: string; salt: string }> {
  const salt = randomBytes(SALT_BYTES);
  const key = await pbkdf2(password, salt, PBKDF2_ITERATIONS, HASH_BYTES);
  return { passHash: `${HASH_SCHEME}$${PBKDF2_ITERATIONS}$${toBase64(key)}`, salt: toBase64(salt) };
}

export async function verifyPassword(password: string, passHash: string, saltB64: string): Promise<boolean> {
  const [scheme, iterText, keyB64, extra] = passHash.split('$');
  if (scheme !== HASH_SCHEME || !iterText || !keyB64 || extra !== undefined) return false;
  const iterations = Number(iterText);
  if (!Number.isSafeInteger(iterations) || iterations < 1 || iterations > MAX_WORKERS_PBKDF2_ITERATIONS) return false;
  let expected: Uint8Array<ArrayBuffer>;
  let salt: Uint8Array<ArrayBuffer>;
  try {
    expected = fromBase64(keyB64);
    salt = fromBase64(saltB64);
  } catch {
    return false;
  }
  if (expected.byteLength === 0) return false;
  const actual = await pbkdf2(password, salt, iterations, expected.byteLength);
  return timingSafeEqual(actual, expected);
}

const DUMMY_SALT = new Uint8Array(SALT_BYTES);

/** Burns the same PBKDF2 cost as a real check so unknown usernames can't be told apart by timing. */
export async function burnPasswordCheck(password: string): Promise<void> {
  await pbkdf2(password, DUMMY_SALT, PBKDF2_ITERATIONS, HASH_BYTES);
}

/** New bearer token for the client plus the SHA-256 hex digest that goes in the sessions table. */
export async function newSessionToken(): Promise<{ token: string; tokenHash: string }> {
  const token = toBase64Url(randomBytes(TOKEN_BYTES));
  return { token, tokenHash: await sha256Hex(token) };
}
