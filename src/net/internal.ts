/**
 * Wild Mystics net layer: plumbing shared by auth.ts and cloudsave.ts. Internal to src/net;
 * import from './auth' and './cloudsave' instead.
 *
 * Contract
 * - localStorage keys: 'wm-accounts' (local + guest profiles), 'wm-session' (signed-in
 *   account, plus the bearer token for cloud accounts), 'wm-api-url' (dev override for the
 *   API base; 'off' forces local mode), 'wm-save-version-<accountId>' (last cloud save
 *   version this device has seen).
 * - Every storage access is wrapped: private mode or blocked storage never throws out of here.
 * - apiRequest() never throws. status 0 means network failure, CORS failure or timeout.
 * - Validation rules and size caps mirror server/src/validate.ts and server/src/config.ts.
 */

import type { Account, AccountMode } from './auth';

export const KEY_ACCOUNTS = 'wm-accounts';
export const KEY_SESSION = 'wm-session';
export const KEY_API_URL = 'wm-api-url';
export const KEY_SAVE_VERSION_PREFIX = 'wm-save-version-';

export const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const EMAIL_MAX = 254;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 256;
/** Largest cloud save in UTF-8 bytes (production D1 caps a row at 2,000,000 bytes). */
export const MAX_SAVE_BYTES = 1_990_000;
/** The server rejects request bodies above this. */
export const MAX_BODY_BYTES = 2.5 * 1024 * 1024;

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const isOffline = (): boolean => typeof navigator !== 'undefined' && navigator.onLine === false;

export const utf8Length = (text: string): number => new TextEncoder().encode(text).byteLength;

// ---------------------------------------------------------------------------------------
// Storage

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null; // e.g. SecurityError in a sandboxed iframe
  }
}

export function storageGet(key: string): string | null {
  try {
    return storage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

/** False when storage is missing, blocked or full. */
export function storageSet(key: string, value: string): boolean {
  try {
    const s = storage();
    if (!s) return false;
    s.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function storageRemove(key: string): void {
  try {
    storage()?.removeItem(key);
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------------------
// Session ('wm-session')

export interface SessionRecord {
  v: 1;
  mode: AccountMode;
  /** Bearer token; cloud sessions only. */
  token?: string;
  account: Account;
}

const MODES: readonly AccountMode[] = ['cloud', 'local', 'guest'];

export function toAccount(value: unknown, mode: AccountMode): Account | null {
  if (!isRecord(value)) return null;
  const { id, username, email, createdAt } = value;
  if (typeof id !== 'string' || !id || typeof username !== 'string' || !username) return null;
  if (typeof createdAt !== 'number' || !Number.isFinite(createdAt)) return null;
  const account: Account = { id, username, createdAt, mode };
  if (typeof email === 'string' && email) account.email = email;
  return Object.freeze(account);
}

let sessionMemo: { raw: string | null; record: SessionRecord | null } | null = null;

function parseSession(raw: string | null): SessionRecord | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(value) || value.v !== 1) return null;
  const mode = value.mode as AccountMode;
  if (!MODES.includes(mode)) return null;
  const account = toAccount(value.account, mode);
  if (!account) return null;
  if (mode === 'cloud') {
    if (typeof value.token !== 'string' || !value.token) return null;
    return { v: 1, mode, token: value.token, account };
  }
  return { v: 1, mode, account };
}

export function readSession(): SessionRecord | null {
  const raw = storageGet(KEY_SESSION);
  if (sessionMemo && sessionMemo.raw === raw) return sessionMemo.record;
  const record = parseSession(raw);
  sessionMemo = { raw, record };
  return record;
}

/** False if the session could not be persisted. */
export function writeSession(record: SessionRecord): boolean {
  const raw = JSON.stringify(record);
  if (!storageSet(KEY_SESSION, raw)) return false;
  sessionMemo = { raw, record: parseSession(raw) };
  return true;
}

export function clearSession(): void {
  storageRemove(KEY_SESSION);
  sessionMemo = null;
}

// ---------------------------------------------------------------------------------------
// Local profiles ('wm-accounts')

export interface LocalAccountRecord {
  id: string;
  username: string;
  email?: string;
  createdAt: number;
  mode: 'local' | 'guest';
  /** 'pbkdf2_sha256$<iterations>$<base64>' (local accounts only; guests have no password). */
  hash?: string;
  /** base64 salt (local accounts only). */
  salt?: string;
}

export function readLocalAccounts(): LocalAccountRecord[] {
  const raw = storageGet(KEY_ACCOUNTS);
  if (!raw) return [];
  let list: unknown;
  try {
    list = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(list)) return [];
  return list.filter((item): item is LocalAccountRecord => {
    if (!isRecord(item) || (item.mode !== 'local' && item.mode !== 'guest')) return false;
    if (!toAccount(item, item.mode)) return false;
    return item.mode === 'guest' || (typeof item.hash === 'string' && typeof item.salt === 'string');
  });
}

export function writeLocalAccounts(list: LocalAccountRecord[]): boolean {
  return storageSet(KEY_ACCOUNTS, JSON.stringify(list));
}

// ---------------------------------------------------------------------------------------
// API

function envApiUrl(): string {
  try {
    const value: unknown = import.meta.env.VITE_API_URL;
    return typeof value === 'string' ? value : '';
  } catch {
    return ''; // not running under Vite
  }
}

function normalizeBase(url: string): string | null {
  const base = url.trim().replace(/\/+$/, '').replace(/\/api$/i, '');
  return /^https?:\/\/[^\s/]+/i.test(base) ? base : null;
}

/** 'wm-api-url' (if set) beats VITE_API_URL; 'off' / 'none' / 'local' force local mode. */
export function resolveApiBase(): string | null {
  const override = storageGet(KEY_API_URL)?.trim();
  if (override) return /^(off|none|local)$/i.test(override) ? null : normalizeBase(override);
  return normalizeBase(envApiUrl());
}

export interface ApiResponse {
  /** HTTP status, or 0 for a network/CORS failure or timeout. */
  status: number;
  /** Parsed JSON body, or null. */
  body: unknown;
}

export async function apiRequest(
  base: string,
  path: string,
  options: { method?: string; json?: unknown; body?: string; token?: string; timeoutMs?: number } = {},
): Promise<ApiResponse> {
  const headers: Record<string, string> = {};
  const body = options.json !== undefined ? JSON.stringify(options.json) : options.body;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), options.timeoutMs ?? 10_000) : null;
  try {
    const res = await fetch(`${base}${path}`, { method: options.method ?? 'GET', headers, body, signal: controller?.signal });
    let parsed: unknown = null;
    try {
      const text = await res.text();
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }
    return { status: res.status, body: parsed };
  } catch {
    return { status: 0, body: null };
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

/** The server's player-facing `error` text, else `fallback`. */
export function serverMessage(body: unknown, fallback: string): string {
  const message = isRecord(body) ? body.error : undefined;
  return typeof message === 'string' && message.trim() ? message : fallback;
}
