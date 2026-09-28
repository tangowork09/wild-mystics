import { applyD1Migrations } from 'cloudflare:test';
import { env } from 'cloudflare:workers';

// Runs before every test file (each file gets its own isolated D1).
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
