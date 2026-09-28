export interface Env {
  DB: D1Database;
}

/** The user object every endpoint returns. `email` is null when none was given. */
export interface PublicUser {
  id: string;
  username: string;
  email: string | null;
  createdAt: number;
}

export interface UserRow {
  id: string;
  username: string;
  email: string | null;
  pass_hash: string;
  salt: string;
  created_at: number;
}

export type AppEnv = {
  Bindings: Env;
  Variables: {
    user: PublicUser;
  };
};

/** Error codes in `{ error, code }` JSON bodies. The client maps these onto AuthError codes. */
export type ErrorCode =
  | 'invalid'
  | 'weak'
  | 'taken'
  | 'unauthorized'
  | 'not_found'
  | 'conflict'
  | 'too_large'
  | 'rate_limited'
  | 'server';
