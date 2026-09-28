# Wild Mystics API

Accounts and cloud saves for Wild Mystics: a Cloudflare Worker (Hono) with a D1 (SQLite) database.
The game's client for it lives in `../src/net/` (`auth.ts`, `cloudsave.ts`).

```
server/
  src/index.ts          routes, CORS, body limit, error handling
  src/session.ts        bearer-token sessions (requireAuth middleware)
  src/crypto.ts         PBKDF2 password hashing, token generation
  src/validate.ts       input rules (mirrored in ../src/net/internal.ts)
  src/throttle.ts       per-IP login/signup throttle (D1 table)
  src/config.ts         limits and tunables
  migrations/0001_init.sql
  test/                 vitest suites that run inside workerd against a local D1
  test/client/          the game's src/net client driven against this Worker
  scripts/smoke.sh      curl end-to-end check against a running server
```

## Setup and local development

Requires Node 20+. Nothing here needs a Cloudflare account until you deploy.

```bash
cd server
npm install
npm run db:migrate:local      # wrangler d1 migrations apply wild-mystics --local
npm run dev                   # wrangler dev --local on http://localhost:8787
curl http://localhost:8787/api/health     # {"ok":true}
```

Local data lives in `server/.wrangler/state/` (git-ignored). Delete that folder to start over.
To reach the API from a phone on your LAN, run `npm run dev -- --ip 0.0.0.0` and use `http://<your-LAN-IP>:8787`.

### Tests

```bash
npm test            # runs in workerd with a fresh local D1 per test file: API + src/net client integration
npm run typecheck   # server source and tests (the client is type-checked from the repo root)
npm run smoke       # curl end-to-end check; needs `npm run dev` running in another terminal
                    # API=https://<your worker> npm run smoke   checks a deployment (creates a throwaway account)
```

Tests use `@cloudflare/vitest-plugin`, the renamed successor of `@cloudflare/vitest-pool-workers`.

## Pointing the game at the API

`src/net` picks the API base URL in this order:

1. `localStorage['wm-api-url']`, a per-browser override for testing. Set it to `off` to force local-only accounts.
2. `import.meta.env.VITE_API_URL`, baked in by Vite at build time.
3. Neither set: no cloud. Accounts and saves stay on the device (local mode).

Use the Worker's origin with no trailing `/api`. For example:

```bash
# repo root, local dev: .env.local (Vite loads it automatically)
VITE_API_URL=http://localhost:8787

# production build
VITE_API_URL=https://wild-mystics-api.<your-subdomain>.workers.dev npm run build
```

Or, in the browser console of a running game: `localStorage.setItem('wm-api-url', 'http://localhost:8787')`.

## Deploy

```bash
cd server
npx wrangler login                                   # once, opens the browser
npx wrangler d1 create wild-mystics                  # prints a database_id
#   paste that id into wrangler.toml -> [[d1_databases]] database_id (replacing the zero placeholder)
npx wrangler d1 migrations apply wild-mystics --remote
npx wrangler deploy                                  # prints https://wild-mystics-api.<subdomain>.workers.dev
API=https://wild-mystics-api.<subdomain>.workers.dev npm run smoke   # optional check
```

Then build the game with `VITE_API_URL` set to that URL. Future schema changes go in new files
(`migrations/0002_*.sql`) applied the same way, `--local` first.

**Plan note:** a signup or login spends about 10 ms of CPU on PBKDF2 (100,000 iterations). The
Workers Free plan's CPU limit is 10 ms per request, with some tolerance for occasional overruns. If
you see error 1102 ("exceeded CPU") on signup/login, move to Workers Paid ($5/mo, 30 s CPU). Don't
lower the iteration count to fit.

## API

All bodies are JSON. Errors look like `{ "error": "<text safe to show players>", "code": "...", "field"?: "..." }`.
`user` is `{ id, username, email: string | null, createdAt }`. Timestamps are epoch milliseconds.
Authenticated routes need `Authorization: Bearer <token>`.

| Method | Path | Body | Success | Errors |
|---|---|---|---|---|
| GET | `/api/health` | | `{ ok: true }` | |
| POST | `/api/auth/signup` | `{ username, email?, password }` | 201 `{ token, user }` | 400 `invalid`/`weak`, 409 `taken` (`field`: username or email), 429 |
| POST | `/api/auth/login` | `{ login, password }` (username or email) | `{ token, user }` | 400, 401 (same message for any bad credentials), 429 |
| POST | `/api/auth/logout` | (Bearer) | `{ ok: true }`: deletes that session only | 401 without a token |
| GET | `/api/me` | (Bearer) | `{ user }` | 401 |
| GET | `/api/save` | (Bearer) | `{ data, version, updatedAt }` | 404 `not_found` if none yet, 401 |
| PUT | `/api/save` | (Bearer) `{ data: string, baseVersion: number }` | `{ version, updatedAt }` | 409 `{ conflict: true, version, updatedAt }`, 413 `too_large`, 400, 401 |

Rules:

- **Username**: 3-20 chars of `[A-Za-z0-9_]`, unique ignoring case.
- **Email**: optional (missing or blank means none), unique ignoring case.
- **Password**: 8-256 chars.
- **Saves**: the first save uses `baseVersion: 0` and gets version 1. Every accepted write bumps the version by one.
  If `baseVersion` doesn't match the stored version, nothing is written and you get 409 with the current version.
  The client decides: re-send with `baseVersion` set to that version to overwrite, or GET and take the cloud copy.
  The compare-and-swap is a single atomic statement, so two devices can't both win.
- **Size limits**: bodies over 2.5 MiB get 413 before parsing. `data` may be up to 1,990,000 UTF-8 bytes.
  "2 MB" is capped just under D1's 2,000,000-byte row limit. Local D1 does not enforce that limit, so don't raise
  the cap based on local tests.
- **CORS**: `Access-Control-Allow-Origin: *` for every origin (web, `http://localhost:*`, `capacitor://localhost`,
  Android WebView). This is safe because auth is a bearer header, never cookies. Preflights are cached for 24 h.

## Security and limitations

- **Passwords**: PBKDF2-HMAC-SHA256, 100,000 iterations, 16-byte random salt, constant-time compare.
  Stored as `pbkdf2_sha256$<iterations>$<base64>`, so the work factor can change later without breaking old accounts.
  100,000 is the maximum production Workers allow; wrangler dev and vitest don't enforce it.
  Logins for unknown users still run a PBKDF2, so response time doesn't reveal which usernames exist.
- **Sessions**: a random 32-byte token (base64url) goes to the client. D1 stores only SHA-256(token).
  Sessions last 30 days and slide forward on use (at most one write per day). Logout revokes one device.
- **Throttling** (`rate_limits` table, fixed windows):
  - Login: 10 failed logins per IP per 15 min, then 429 with `Retry-After`. Success doesn't reset the count.
  - Signup: 20 new accounts per IP per hour.
  - IPv6 is grouped per /64.
  - Limitations: it keys on `CF-Connecting-IP`, so distributed attacks from many IPs get through. Check-then-increment
    can overshoot slightly under bursts. Each counted attempt is a D1 write. For real abuse, add a Cloudflare WAF
    rate-limiting rule and/or Turnstile on signup.
- **No password reset or email verification yet.** The email is stored for a future reset flow.
- **Client token storage**: the client keeps the bearer token in `localStorage`, the usual trade-off for SPA/Capacitor
  apps. XSS in the game could read it.
