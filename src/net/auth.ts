/**
 * Wild Mystics accounts (client). Dependency-free: fetch + WebCrypto + localStorage.
 *
 * Contract
 * - Mode choice: when apiBase() is set AND cloudAvailable() is true, signup/login use the
 *   cloud API (server/) and the bearer token is kept in localStorage 'wm-session'.
 *   Otherwise they create/verify LOCAL accounts stored on this device in 'wm-accounts'
 *   (PBKDF2-SHA256 hash + salt, never the password). A local account never syncs.
 *   signup/login re-check a cached "unavailable" answer before falling back to local.
 * - Guest: a local profile with mode 'guest' and a generated name like "Wayfarer-4821".
 *   There is one per device and playAsGuest() reuses it.
 * - Validation matches the server: username 3-20 of [A-Za-z0-9_] (unique ignoring case),
 *   email optional (empty string = none), password at least 8 characters.
 * - login(): with the cloud up, the cloud is tried first. If it rejects the credentials but
 *   a local account on this device matches, that local account signs in instead. With the
 *   API configured but unreachable and no matching local account, it throws 'network'.
 * - restoreSession() (call once on boot): cloud sessions are re-validated with GET /api/me.
 *   401 signs the device out (returns null). Offline or server trouble keeps the cached
 *   account. Local/guest sessions are restored if their profile still exists.
 * - currentAccount() is synchronous and reads the stored session (even before
 *   restoreSession() has run). Returned Account objects are frozen.
 * - Every failure is an AuthError. `message` is written to be shown to players; `code` is
 *   invalid | weak | taken | unauthorized | network | server (server errors and rate
 *   limiting). `field` names the offending form field when known.
 */

import { hashPassword, randomId, randomInt, verifyPassword } from './crypto';
import {
  apiRequest,
  clearSession,
  EMAIL_MAX,
  EMAIL_RE,
  isOffline,
  isRecord,
  PASSWORD_MAX,
  PASSWORD_MIN,
  readLocalAccounts,
  readSession,
  resolveApiBase,
  serverMessage,
  toAccount,
  USERNAME_RE,
  writeLocalAccounts,
  writeSession,
  type ApiResponse,
  type LocalAccountRecord,
  type SessionRecord,
} from './internal';

export type AccountMode = 'cloud' | 'local' | 'guest';

export interface Account {
  id: string;
  username: string;
  email?: string;
  createdAt: number;
  mode: AccountMode;
}

export class AuthError extends Error {
  code: 'invalid' | 'taken' | 'weak' | 'network' | 'server' | 'unauthorized';
  /** The form field the problem is about, when known. */
  field?: 'username' | 'email' | 'password' | 'login';

  constructor(code: AuthError['code'], message: string, field?: AuthError['field']) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
    if (field) this.field = field;
  }
}

const HEALTH_TIMEOUT_MS = 2_500;
const HEALTH_TTL_MS = 60_000;
const AUTH_TIMEOUT_MS = 10_000;
const RESTORE_TIMEOUT_MS = 4_000;
const LOGOUT_TIMEOUT_MS = 3_000;

const NETWORK_MESSAGE = "Can't reach the Wild Mystics server. Check your connection and try again.";
const WRONG_CREDENTIALS = 'Incorrect username/email or password.';

/** API origin: localStorage 'wm-api-url' override, else import.meta.env.VITE_API_URL, else null. */
export function apiBase(): string | null {
  return resolveApiBase();
}

let health: { base: string; ok: boolean; at: number } | null = null;
let healthCheck: { base: string; promise: Promise<boolean> } | null = null;

const rememberHealth = (base: string, ok: boolean) => {
  health = { base, ok, at: Date.now() };
};
const forgetHealth = () => {
  health = null;
};

/** GET /api/health with a 2.5 s timeout. The answer is cached for 60 s per API base. */
export async function cloudAvailable(): Promise<boolean> {
  return checkHealth(false);
}

/**
 * For player-initiated signup/login: trust a cached "up", but re-check a cached "down" so a
 * device that booted offline doesn't create a local account a minute after the network is back.
 */
function cloudReady(): Promise<boolean> {
  const base = apiBase();
  return checkHealth(!!health && health.base === base && !health.ok);
}

async function checkHealth(fresh: boolean): Promise<boolean> {
  const base = apiBase();
  if (!base || isOffline()) return false;
  if (!fresh && health && health.base === base && Date.now() - health.at < HEALTH_TTL_MS) return health.ok;
  if (healthCheck && healthCheck.base === base) return healthCheck.promise;
  const promise = apiRequest(base, '/api/health', { timeoutMs: HEALTH_TIMEOUT_MS }).then((res) => {
    const ok = res.status === 200 && isRecord(res.body) && res.body.ok === true;
    rememberHealth(base, ok);
    return ok;
  });
  healthCheck = { base, promise };
  try {
    return await promise;
  } finally {
    if (healthCheck?.promise === promise) healthCheck = null;
  }
}

export async function signup(username: string, email: string, password: string): Promise<Account> {
  const input = checkSignup(username, email, password);
  const base = apiBase();
  if (base && (await cloudReady())) {
    const res = await apiRequest(base, '/api/auth/signup', {
      method: 'POST',
      json: { username: input.username, email: input.email ?? '', password },
      timeoutMs: AUTH_TIMEOUT_MS,
    });
    return finishCloudAuth(base, res);
  }
  return localSignup(input.username, input.email, password);
}

export async function login(loginId: string, password: string): Promise<Account> {
  const id = loginId.trim();
  if (!id) throw new AuthError('invalid', 'Enter your username or email.', 'login');
  if (!password) throw new AuthError('invalid', 'Enter your password.', 'password');
  const local = findLocalAccount(id);
  const base = apiBase();
  if (base && (await cloudReady())) {
    const res = await apiRequest(base, '/api/auth/login', {
      method: 'POST',
      json: { login: id, password },
      timeoutMs: AUTH_TIMEOUT_MS,
    });
    if ((res.status === 401 || res.status === 0) && local) {
      const account = await localLogin(local, password);
      if (account) return account;
    }
    return finishCloudAuth(base, res);
  }
  if (local) {
    const account = await localLogin(local, password);
    if (account) return account;
    throw new AuthError('unauthorized', WRONG_CREDENTIALS);
  }
  if (base) throw new AuthError('network', "Can't reach the server to sign in. Check your connection, or play as a guest.");
  throw new AuthError('unauthorized', WRONG_CREDENTIALS);
}

export async function playAsGuest(): Promise<Account> {
  const accounts = readLocalAccounts();
  let guest = accounts.find((a) => a.mode === 'guest');
  if (!guest) {
    guest = { id: randomId(), username: `Wayfarer-${1000 + randomInt(9000)}`, createdAt: Date.now(), mode: 'guest' };
    if (!writeLocalAccounts([...accounts, guest])) throw storageError();
  }
  return startLocalSession(guest);
}

/** Signs this device out. Cloud sessions are also revoked on the server (best effort). */
export async function logout(): Promise<void> {
  const session = readSession();
  clearSession();
  const base = apiBase();
  if (session?.mode === 'cloud' && session.token && base && !isOffline()) {
    await apiRequest(base, '/api/auth/logout', { method: 'POST', token: session.token, timeoutMs: LOGOUT_TIMEOUT_MS });
  }
}

export function currentAccount(): Account | null {
  return readSession()?.account ?? null;
}

export async function restoreSession(): Promise<Account | null> {
  const session = readSession();
  if (!session) return null;

  if (session.mode !== 'cloud') {
    const record = readLocalAccounts().find((a) => a.id === session.account.id && a.mode === session.mode);
    if (!record) {
      clearSession();
      return null;
    }
    return startLocalSession(record);
  }

  const base = apiBase();
  if (!base || isOffline()) return session.account;
  const res = await apiRequest(base, '/api/me', { token: session.token, timeoutMs: RESTORE_TIMEOUT_MS });
  if (res.status === 401) {
    clearSession();
    return null;
  }
  if (res.status === 200) {
    const account = toAccount(isRecord(res.body) ? res.body.user : null, 'cloud');
    if (account) {
      rememberHealth(base, true);
      writeSession({ ...session, account });
      return account;
    }
  }
  if (res.status === 0) forgetHealth();
  return session.account; // offline or server trouble: keep playing as the cached account
}

/** Local and guest profiles stored on this device, oldest first. */
export function listLocalProfiles(): Account[] {
  return readLocalAccounts().map((record) => toAccount(record, record.mode)).filter((a): a is Account => a !== null);
}

// ---------------------------------------------------------------------------------------

function checkSignup(username: string, email: string, password: string): { username: string; email?: string } {
  const name = username.trim();
  if (!USERNAME_RE.test(name)) {
    throw new AuthError('invalid', 'Username must be 3-20 characters: letters, numbers or underscores.', 'username');
  }
  const mail = email.trim();
  if (mail && (mail.length > EMAIL_MAX || !EMAIL_RE.test(mail))) {
    throw new AuthError('invalid', "That email address doesn't look right.", 'email');
  }
  if (password.length < PASSWORD_MIN) {
    throw new AuthError('weak', `Password must be at least ${PASSWORD_MIN} characters.`, 'password');
  }
  if (password.length > PASSWORD_MAX) {
    throw new AuthError('invalid', `Password must be at most ${PASSWORD_MAX} characters.`, 'password');
  }
  return mail ? { username: name, email: mail } : { username: name };
}

const storageError = () =>
  new AuthError('server', "Couldn't save your profile on this device. Storage may be full or blocked (private browsing?).");

function persist(record: SessionRecord): Account {
  if (!writeSession(record)) throw storageError();
  return readSession()?.account ?? record.account;
}

function asField(value: unknown): AuthError['field'] {
  return value === 'username' || value === 'email' || value === 'password' || value === 'login' ? value : undefined;
}

function errorFrom(res: ApiResponse): AuthError {
  const body = isRecord(res.body) ? res.body : {};
  const field = asField(body.field);
  switch (res.status) {
    case 400:
      return new AuthError(body.code === 'weak' ? 'weak' : 'invalid', serverMessage(body, 'Please check the form and try again.'), field);
    case 401:
      return new AuthError('unauthorized', serverMessage(body, WRONG_CREDENTIALS), field);
    case 409:
      return new AuthError('taken', serverMessage(body, 'That username or email is already in use.'), field);
    case 413:
      return new AuthError('invalid', serverMessage(body, 'That request is too large.'), field);
    case 429:
      return new AuthError('server', serverMessage(body, 'Too many attempts. Please wait a few minutes and try again.'), field);
    default:
      return new AuthError('server', serverMessage(body, 'The server had a problem. Please try again in a moment.'), field);
  }
}

function finishCloudAuth(base: string, res: ApiResponse): Account {
  if (res.status === 0) {
    forgetHealth();
    throw new AuthError('network', NETWORK_MESSAGE);
  }
  if (res.status !== 200 && res.status !== 201) throw errorFrom(res);
  const token = isRecord(res.body) ? res.body.token : undefined;
  const account = toAccount(isRecord(res.body) ? res.body.user : null, 'cloud');
  if (typeof token !== 'string' || !token || !account) {
    throw new AuthError('server', 'The server sent an unexpected reply. Please try again.');
  }
  rememberHealth(base, true);
  return persist({ v: 1, mode: 'cloud', token, account });
}

function findLocalAccount(loginId: string): LocalAccountRecord | undefined {
  const key = loginId.toLowerCase();
  return readLocalAccounts().find(
    (a) => a.mode === 'local' && (a.username.toLowerCase() === key || (!!a.email && a.email.toLowerCase() === key)),
  );
}

function startLocalSession(record: LocalAccountRecord): Account {
  const account = toAccount(record, record.mode);
  if (!account) throw storageError();
  return persist({ v: 1, mode: record.mode, account });
}

async function localLogin(record: LocalAccountRecord, password: string): Promise<Account | null> {
  if (!record.hash || !record.salt) return null;
  if (!(await verifyPassword(password, record.hash, record.salt))) return null;
  return startLocalSession(record);
}

function localClash(accounts: LocalAccountRecord[], username: string, email: string | undefined): AuthError | null {
  const name = username.toLowerCase();
  const mail = email?.toLowerCase();
  for (const a of accounts) {
    if (a.mode !== 'local') continue;
    if (a.username.toLowerCase() === name) return new AuthError('taken', 'That username is already taken on this device.', 'username');
    if (mail && a.email?.toLowerCase() === mail) {
      return new AuthError('taken', 'A profile with that email already exists on this device.', 'email');
    }
  }
  return null;
}

async function localSignup(username: string, email: string | undefined, password: string): Promise<Account> {
  const clash = localClash(readLocalAccounts(), username, email);
  if (clash) throw clash;
  const { hash, salt } = await hashPassword(password);
  const record: LocalAccountRecord = { id: randomId(), username, createdAt: Date.now(), mode: 'local', hash, salt };
  if (email) record.email = email;
  const latest = readLocalAccounts(); // re-read: another tab may have written while we hashed
  const lateClash = localClash(latest, username, email);
  if (lateClash) throw lateClash;
  if (!writeLocalAccounts([...latest, record])) throw storageError();
  return startLocalSession(record);
}
