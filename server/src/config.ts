// Tunables for the Wild Mystics API. The client mirrors the validation rules and
// size caps in src/net/internal.ts; keep the two in sync.

/**
 * PBKDF2-SHA256 work factor. Do not raise it: production Workers throw NotSupportedError
 * above 100,000 iterations, and wrangler dev/vitest do NOT enforce that cap, so a higher
 * value would pass every local test and then 500 on signup/login once deployed.
 */
export const PBKDF2_ITERATIONS = 100_000;
export const SALT_BYTES = 16;
export const HASH_BYTES = 32;

/** Session bearer tokens: 32 random bytes, base64url (43 chars). Only SHA-256(token) is stored. */
export const TOKEN_BYTES = 32;
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Active sessions slide forward to a fresh 30 days, at most one DB write per day per session. */
export const SESSION_RENEW_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** Any request body above this is rejected with 413 before it is parsed. */
export const MAX_BODY_BYTES = 2.5 * 1024 * 1024;
/**
 * Largest accepted save blob, in UTF-8 bytes. Production D1 caps a single string/row at
 * 2,000,000 bytes (local D1 doesn't enforce it), so "2 MB" here means just under that,
 * leaving headroom for the other columns in the row.
 */
export const MAX_SAVE_BYTES = 1_990_000;

/** Failed logins allowed per client IP (IPv6 grouped per /64) inside one window. */
export const LOGIN_MAX_FAILURES = 10;
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;
/** Account creations allowed per client IP inside one window. */
export const SIGNUP_MAX = 20;
export const SIGNUP_WINDOW_MS = 60 * 60 * 1000;
/** Rate-limit rows older than this are pruned opportunistically. */
export const RATE_LIMIT_RETENTION_MS = 24 * 60 * 60 * 1000;
