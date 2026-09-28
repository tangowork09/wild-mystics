/**
 * Wild Mystics net layer: password hashing for LOCAL (on-device) accounts, plus random ids.
 * Internal to src/net; not part of the public API.
 *
 * Contract
 * - hashPassword() -> { hash: 'pbkdf2_sha256$<iterations>$<base64 key>', salt: <base64 16 bytes> },
 *   the same format the server stores. Only hash + salt are ever persisted, never the password.
 * - Uses WebCrypto PBKDF2-HMAC-SHA256 when crypto.subtle exists. Browsers hide crypto.subtle
 *   on non-secure origins (e.g. the Vite dev server opened on a phone at http://192.168.x.x),
 *   so a small pure-TypeScript PBKDF2 is used there instead. Both give identical output.
 */

export const LOCAL_PBKDF2_ITERATIONS = 100_000;
const HASH_SCHEME = 'pbkdf2_sha256';
const SALT_BYTES = 16;
const KEY_BYTES = 32;
/** Refuse absurd work factors from a tampered record rather than freezing the page. */
const MAX_ITERATIONS = 5_000_000;

const encoder = new TextEncoder();

export function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

/** Random integer in [0, max). */
export function randomInt(max: number): number {
  return crypto.getRandomValues(new Uint32Array(1))[0] % max;
}

/** RFC 4122 v4 UUID. crypto.randomUUID only exists in secure contexts, so build one if needed. */
export function randomId(): string {
  if (typeof crypto.randomUUID === 'function') {
    try {
      return crypto.randomUUID();
    } catch {
      /* fall through */
    }
  }
  const b = randomBytes(16);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function pbkdf2Sha256(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number, length: number): Promise<Uint8Array> {
  const pw = encoder.encode(password);
  const subtle = globalThis.crypto?.subtle;
  if (subtle) {
    try {
      const key = await subtle.importKey('raw', pw, 'PBKDF2', false, ['deriveBits']);
      const bits = await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, length * 8);
      return new Uint8Array(bits);
    } catch {
      /* e.g. an old WebView without PBKDF2: use the portable version */
    }
  }
  return pbkdf2Portable(pw, salt, iterations, length);
}

export async function hashPassword(password: string): Promise<{ hash: string; salt: string }> {
  const salt = randomBytes(SALT_BYTES);
  const key = await pbkdf2Sha256(password, salt, LOCAL_PBKDF2_ITERATIONS, KEY_BYTES);
  return { hash: `${HASH_SCHEME}$${LOCAL_PBKDF2_ITERATIONS}$${toBase64(key)}`, salt: toBase64(salt) };
}

export async function verifyPassword(password: string, hash: string, saltB64: string): Promise<boolean> {
  const parts = hash.split('$');
  if (parts.length !== 3 || parts[0] !== HASH_SCHEME) return false;
  const iterations = Number(parts[1]);
  if (!Number.isSafeInteger(iterations) || iterations < 1 || iterations > MAX_ITERATIONS) return false;
  let expected: Uint8Array;
  let salt: Uint8Array<ArrayBuffer>;
  try {
    expected = fromBase64(parts[2]);
    salt = fromBase64(saltB64);
  } catch {
    return false;
  }
  if (expected.length === 0) return false;
  return constantTimeEqual(await pbkdf2Sha256(password, salt, iterations, expected.length), expected);
}

// ---------------------------------------------------------------------------------------
// Portable PBKDF2-HMAC-SHA256 (FIPS 180-4 / RFC 2104 / RFC 8018). Only used without WebCrypto.
// The HMAC inner/outer key blocks are absorbed once, so each iteration costs exactly two
// SHA-256 compressions with no allocation.

const K = new Int32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
const IV = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];

/** One SHA-256 compression of the block already loaded into w[0..15]. */
function compress(state: Int32Array, w: Int32Array): void {
  for (let i = 16; i < 64; i++) {
    const x = w[i - 15];
    const y = w[i - 2];
    const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
    const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
    w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
  }
  let a = state[0], b = state[1], c = state[2], d = state[3];
  let e = state[4], f = state[5], g = state[6], h = state[7];
  for (let i = 0; i < 64; i++) {
    const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
    const t1 = (h + S1 + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0;
    const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
    const t2 = (S0 + ((a & b) ^ (a & c) ^ (b & c))) | 0;
    h = g; g = f; f = e; e = (d + t1) | 0;
    d = c; c = b; b = a; a = (t1 + t2) | 0;
  }
  state[0] = (state[0] + a) | 0; state[1] = (state[1] + b) | 0;
  state[2] = (state[2] + c) | 0; state[3] = (state[3] + d) | 0;
  state[4] = (state[4] + e) | 0; state[5] = (state[5] + f) | 0;
  state[6] = (state[6] + g) | 0; state[7] = (state[7] + h) | 0;
}

function loadBlock(w: Int32Array, bytes: Uint8Array, offset: number): void {
  for (let i = 0; i < 16; i++) {
    const j = offset + i * 4;
    w[i] = (bytes[j] << 24) | (bytes[j + 1] << 16) | (bytes[j + 2] << 8) | bytes[j + 3];
  }
}

/** Absorbs `msg` plus SHA-256 padding into a state that has already consumed `prefixLen` bytes. */
function finish(state: Int32Array, msg: Uint8Array, prefixLen: number, w: Int32Array): void {
  const padded = new Uint8Array((msg.length + 9 + 63) & ~63);
  padded.set(msg);
  padded[msg.length] = 0x80;
  const bits = (prefixLen + msg.length) * 8;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(bits / 0x100000000));
  view.setUint32(padded.length - 4, bits >>> 0);
  for (let offset = 0; offset < padded.length; offset += 64) {
    loadBlock(w, padded, offset);
    compress(state, w);
  }
}

function stateBytes(state: Int32Array): Uint8Array {
  const out = new Uint8Array(32);
  const view = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) view.setInt32(i * 4, state[i]);
  return out;
}

export function sha256Portable(msg: Uint8Array): Uint8Array {
  const state = Int32Array.from(IV);
  finish(state, msg, 0, new Int32Array(64));
  return stateBytes(state);
}

export function pbkdf2Portable(password: Uint8Array, salt: Uint8Array, iterations: number, length: number): Uint8Array {
  const w = new Int32Array(64);
  const key = password.length > 64 ? sha256Portable(password) : password;
  const pad = new Uint8Array(64);
  const inner = Int32Array.from(IV);
  const outer = Int32Array.from(IV);
  pad.fill(0x36);
  for (let i = 0; i < key.length; i++) pad[i] ^= key[i];
  loadBlock(w, pad, 0);
  compress(inner, w);
  pad.fill(0x5c);
  for (let i = 0; i < key.length; i++) pad[i] ^= key[i];
  loadBlock(w, pad, 0);
  compress(outer, w);

  const out = new Uint8Array(length);
  const saltBlock = new Uint8Array(salt.length + 4);
  saltBlock.set(salt);
  const st = new Int32Array(8);
  const u = new Int32Array(8);
  const t = new Int32Array(8);
  for (let block = 1, offset = 0; offset < length; block++, offset += 32) {
    // U1 = HMAC(P, S || INT(block))
    saltBlock[salt.length] = block >>> 24;
    saltBlock[salt.length + 1] = (block >>> 16) & 0xff;
    saltBlock[salt.length + 2] = (block >>> 8) & 0xff;
    saltBlock[salt.length + 3] = block & 0xff;
    st.set(inner);
    finish(st, saltBlock, 64, w);
    u.set(outer);
    finish(u, stateBytes(st), 64, w);
    t.set(u);
    // Uj = HMAC(P, Uj-1): a 32-byte message after a 64-byte key block is one padded block.
    w[8] = 0x80000000 | 0;
    w[9] = w[10] = w[11] = w[12] = w[13] = w[14] = 0;
    w[15] = (64 + 32) * 8;
    for (let j = 1; j < iterations; j++) {
      st.set(inner);
      for (let k = 0; k < 8; k++) w[k] = u[k];
      compress(st, w);
      u.set(outer);
      for (let k = 0; k < 8; k++) w[k] = st[k];
      compress(u, w);
      for (let k = 0; k < 8; k++) t[k] ^= u[k];
    }
    const tBytes = stateBytes(t);
    out.set(tBytes.subarray(0, Math.min(32, length - offset)), offset);
  }
  return out;
}
