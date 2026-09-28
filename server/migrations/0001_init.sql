-- Wild Mystics: accounts, sessions, cloud saves, login/signup throttling.
-- Apply with: npx wrangler d1 migrations apply wild-mystics --local   (or --remote)
-- All timestamps are Unix epoch milliseconds.

CREATE TABLE IF NOT EXISTS users (
  id         TEXT PRIMARY KEY,                     -- crypto.randomUUID()
  username   TEXT NOT NULL UNIQUE COLLATE NOCASE,  -- 3-20 of [A-Za-z0-9_], unique ignoring case
  email      TEXT UNIQUE COLLATE NOCASE,           -- optional (NULL); unique ignoring case
  pass_hash  TEXT NOT NULL,                        -- 'pbkdf2_sha256$<iterations>$<base64 32-byte key>'
  salt       TEXT NOT NULL,                        -- base64 of 16 random bytes
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,                     -- hex SHA-256 of the bearer token; the token itself is never stored
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
-- Per-user cleanup of expired sessions at login (and "sign out everywhere" later).
CREATE INDEX IF NOT EXISTS idx_sessions_user_expires ON sessions (user_id, expires_at);

CREATE TABLE IF NOT EXISTS saves (
  user_id    TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  data       TEXT NOT NULL,                        -- opaque game blob, max 1,990,000 UTF-8 bytes (D1 row cap is 2,000,000)
  version    INTEGER NOT NULL,                     -- 1 on first write, +1 per accepted write (optimistic concurrency)
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS rate_limits (
  bucket       TEXT PRIMARY KEY,                   -- 'login:<ip>' / 'signup:<ip>' (IPv6 grouped per /64)
  window_start INTEGER NOT NULL,
  count        INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rate_limits_window ON rate_limits (window_start);
