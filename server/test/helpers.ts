import { exports } from 'cloudflare:workers';

// Requests go through the Worker's real fetch entrypoint (same code path as production).
const worker = (exports as unknown as { default: Fetcher }).default;

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export interface ApiResult<T = any> {
  status: number;
  body: T;
  headers: Headers;
}

export interface ApiInit {
  method?: string;
  json?: unknown;
  rawBody?: string;
  token?: string;
  /** Sent as CF-Connecting-IP. Defaults to a random IPv4 so throttle buckets don't collide. */
  ip?: string;
  headers?: Record<string, string>;
}

export function randomIp(): string {
  const b = crypto.getRandomValues(new Uint8Array(3));
  return `10.${b[0]}.${b[1]}.${b[2]}`;
}

export async function api<T = any>(path: string, init: ApiInit = {}): Promise<ApiResult<T>> {
  const headers = new Headers(init.headers);
  headers.set('CF-Connecting-IP', init.ip ?? randomIp());
  if (init.token) headers.set('Authorization', `Bearer ${init.token}`);
  let body: string | undefined = init.rawBody;
  if (init.json !== undefined) {
    body = JSON.stringify(init.json);
    headers.set('Content-Type', 'application/json');
  }
  const res = await worker.fetch(`https://api.test${path}`, {
    method: init.method ?? (body === undefined ? 'GET' : 'POST'),
    headers,
    body,
  });
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    /* keep raw text */
  }
  return { status: res.status, body: parsed as T, headers: res.headers };
}

/** A fresh valid username (<= 20 chars of [A-Za-z0-9_]). */
export function uniqueName(prefix = 'p'): string {
  const hex = [...crypto.getRandomValues(new Uint8Array(6))].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${prefix}_${hex}`.slice(0, 20);
}

export interface Signed {
  token: string;
  user: { id: string; username: string; email: string | null; createdAt: number };
  password: string;
}

export async function signUp(overrides: { username?: string; email?: string; password?: string; ip?: string } = {}): Promise<Signed> {
  const password = overrides.password ?? 'hunter2hunter2';
  const res = await api('/api/auth/signup', {
    json: { username: overrides.username ?? uniqueName(), email: overrides.email ?? '', password },
    ip: overrides.ip,
  });
  if (res.status !== 201) throw new Error(`signup failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { ...res.body, password };
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
