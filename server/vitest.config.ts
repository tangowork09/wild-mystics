import { fileURLToPath } from 'node:url';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

// Tests run inside workerd (the real Workers runtime) against a local D1 per test file.
// test/apply-migrations.ts applies migrations/ before each file.
export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      wrangler: { configPath: './wrangler.toml' },
      miniflare: {
        bindings: {
          TEST_MIGRATIONS: await readD1Migrations(fileURLToPath(new URL('./migrations', import.meta.url))),
        },
      },
    })),
  ],
  test: {
    setupFiles: ['./test/apply-migrations.ts'],
    testTimeout: 30_000,
  },
});
