/**
 * Wild Mystics cloud saves (client). The save is an opaque string (the game's JSON); this
 * module only moves it. Debouncing autosaves is the caller's job.
 *
 * Contract
 * - saveKeyFor(account): localStorage key for the game's own save blob:
 *   `wm-save-${account.id}` (cloud, local and guest accounts alike) or 'wm-save-guest' for null.
 * - Versioning: the server bumps `version` on every accepted write. This device remembers the
 *   last version it saw in localStorage 'wm-save-version-<accountId>' and sends it as
 *   baseVersion. pullSave() records the version it returns (0 when there is no cloud save),
 *   and a successful pushSave() records the new one.
 * - pushSave() answers:
 *     { ok: true, version }                             accepted.
 *     { ok: false, conflict: true, remoteVersion, ... } another device saved since this one
 *       last synced. Nothing was written. To keep THIS device's save: await pullSave() (which
 *       adopts the remote version as the base), then pushSave(localData) again. To take the
 *       cloud save instead: load the data pullSave() returns.
 *     { ok: false, offline: true }                      not synced: no network, server
 *       trouble, or the account is local/guest. Keep the local copy and retry later.
 * - pullSave() returns null for local/guest accounts, when there is no cloud save yet, or
 *   when the server can't be reached (cloudAvailable() tells these apart). Being offline
 *   never changes the remembered version.
 * - Both throw AuthError('unauthorized') when the server says the session has ended (the
 *   player must sign in again), and pushSave throws AuthError('invalid') when the save is
 *   over the size cap (just under 2 MB of UTF-8).
 * - Calls are serialized, so an autosave and a manual save can't race each other into a
 *   false conflict.
 */

import { apiBase, AuthError, currentAccount, type Account } from './auth';
import {
  apiRequest,
  isOffline,
  isRecord,
  KEY_SAVE_VERSION_PREFIX,
  MAX_BODY_BYTES,
  MAX_SAVE_BYTES,
  readSession,
  serverMessage,
  storageGet,
  storageSet,
  utf8Length,
} from './internal';

const PULL_TIMEOUT_MS = 20_000;
const PUSH_TIMEOUT_MS = 30_000;
const SESSION_ENDED = 'Your session has ended. Please sign in again to sync your save.';

export function saveKeyFor(account: Account | null): string {
  return account ? `wm-save-${account.id}` : 'wm-save-guest';
}

export async function pullSave(): Promise<{ data: string; version: number; updatedAt: number } | null> {
  return serialized(async () => {
    const ctx = cloudContext();
    if (!ctx) return null;
    const res = await apiRequest(ctx.base, '/api/save', { token: ctx.token, timeoutMs: PULL_TIMEOUT_MS });
    if (res.status === 200 && isRecord(res.body)) {
      const { data, version, updatedAt } = res.body;
      if (typeof data === 'string' && isVersion(version) && typeof updatedAt === 'number') {
        setKnownVersion(ctx.accountId, version);
        return { data, version, updatedAt };
      }
      return null;
    }
    if (res.status === 404) {
      setKnownVersion(ctx.accountId, 0);
      return null;
    }
    if (res.status === 401) throw new AuthError('unauthorized', serverMessage(res.body, SESSION_ENDED));
    return null;
  });
}

export async function pushSave(
  data: string,
): Promise<
  | { ok: true; version: number }
  | { ok: false; conflict: true; remoteVersion: number; remoteUpdatedAt: number }
  | { ok: false; offline: true }
> {
  return serialized(async () => {
    const ctx = cloudContext();
    if (!ctx) return { ok: false, offline: true } as const;
    const body = JSON.stringify({ data, baseVersion: knownVersion(ctx.accountId) });
    if (utf8Length(data) > MAX_SAVE_BYTES || utf8Length(body) > MAX_BODY_BYTES) {
      throw new AuthError('invalid', 'This save is too large to sync to the cloud (limit is just under 2 MB).');
    }
    const res = await apiRequest(ctx.base, '/api/save', { method: 'PUT', body, token: ctx.token, timeoutMs: PUSH_TIMEOUT_MS });
    const reply = isRecord(res.body) ? res.body : {};
    if (res.status === 200 && isVersion(reply.version)) {
      setKnownVersion(ctx.accountId, reply.version);
      return { ok: true, version: reply.version } as const;
    }
    if (res.status === 409 && reply.conflict === true) {
      return {
        ok: false,
        conflict: true,
        remoteVersion: isVersion(reply.version) ? reply.version : 0,
        remoteUpdatedAt: typeof reply.updatedAt === 'number' ? reply.updatedAt : 0,
      } as const;
    }
    if (res.status === 401) throw new AuthError('unauthorized', serverMessage(reply, SESSION_ENDED));
    if (res.status === 400 || res.status === 413) {
      throw new AuthError('invalid', serverMessage(reply, 'The server refused this save.'));
    }
    return { ok: false, offline: true } as const;
  });
}

// ---------------------------------------------------------------------------------------

let queue: Promise<unknown> = Promise.resolve();

function serialized<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);
  return run;
}

/** Everything a cloud call needs, or null when the current account can't sync right now. */
function cloudContext(): { base: string; token: string; accountId: string } | null {
  const account = currentAccount();
  const session = readSession();
  const base = apiBase();
  if (!account || account.mode !== 'cloud' || !session?.token || !base || isOffline()) return null;
  return { base, token: session.token, accountId: account.id };
}

const isVersion = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

function knownVersion(accountId: string): number {
  const value = Number(storageGet(KEY_SAVE_VERSION_PREFIX + accountId) ?? 0);
  return isVersion(value) ? value : 0;
}

function setKnownVersion(accountId: string, version: number): void {
  storageSet(KEY_SAVE_VERSION_PREFIX + accountId, String(version));
}
