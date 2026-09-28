// Fixed-window per-IP counters in D1 (table rate_limits).
//
// Limitations, by design for a small game backend:
// - Counters are keyed on the client IP (IPv6 grouped per /64), so attacks spread over
//   many IPs are not stopped. Put a Cloudflare WAF rate-limiting rule or Turnstile in
//   front if that becomes a problem.
// - check-then-increment is not atomic across concurrent requests; a burst can overshoot
//   the limit by a few attempts.
// - Each counted attempt is one D1 write.

import { RATE_LIMIT_RETENTION_MS } from './config';

/** Throttle key for the caller: CF-Connecting-IP (set by Cloudflare; absent in some local tools). */
export function clientKey(req: Request): string {
  const ip = req.headers.get('cf-connecting-ip')?.trim();
  if (!ip) return 'unknown';
  return ip.includes(':') ? ipv6Slash64(ip) : ip;
}

/** One household or phone usually owns a whole IPv6 /64, so count per prefix, not per address. */
function ipv6Slash64(ip: string): string {
  const addr = ip.split('%')[0]!.toLowerCase();
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(addr);
  if (mapped) return mapped[1]!;
  const [head = '', tail] = addr.split('::');
  const headParts = head ? head.split(':') : [];
  let parts = headParts;
  if (tail !== undefined) {
    const tailParts = tail ? tail.split(':') : [];
    const fill = Math.max(0, 8 - headParts.length - tailParts.length);
    parts = [...headParts, ...Array<string>(fill).fill('0'), ...tailParts];
  }
  return `${parts.slice(0, 4).map((p) => p.replace(/^0+(?=.)/, '')).join(':')}::/64`;
}

/** Seconds until `bucket` may try again, or 0 if it is under `max` hits in the current window. */
export async function retryAfterSeconds(db: D1Database, bucket: string, max: number, windowMs: number, now: number): Promise<number> {
  const row = await db
    .prepare('SELECT window_start, count FROM rate_limits WHERE bucket = ?')
    .bind(bucket)
    .first<{ window_start: number; count: number }>();
  if (!row || row.window_start + windowMs <= now || row.count < max) return 0;
  return Math.max(1, Math.ceil((row.window_start + windowMs - now) / 1000));
}

/** Counts one attempt against `bucket`, starting a fresh window if the old one has lapsed. */
export async function recordHit(db: D1Database, bucket: string, windowMs: number, now: number): Promise<void> {
  await db.batch([
    db
      .prepare(
        `INSERT INTO rate_limits (bucket, window_start, count) VALUES (?1, ?2, 1)
         ON CONFLICT(bucket) DO UPDATE SET
           count = CASE WHEN rate_limits.window_start + ?3 <= ?2 THEN 1 ELSE rate_limits.count + 1 END,
           window_start = CASE WHEN rate_limits.window_start + ?3 <= ?2 THEN ?2 ELSE rate_limits.window_start END`,
      )
      .bind(bucket, now, windowMs),
    db.prepare('DELETE FROM rate_limits WHERE window_start < ?').bind(now - RATE_LIMIT_RETENTION_MS),
  ]);
}
