import { env } from 'cloudflare:workers';
import { expect, it } from 'vitest';
import { api, signUp } from './helpers';

// Own file: it breaks the schema, and D1 storage is isolated per test file.
it('turns unexpected failures into a JSON 500 that still carries CORS headers', async () => {
  const { token } = await signUp();
  await env.DB.exec('DROP TABLE saves');
  const res = await api('/api/save', { token, headers: { Origin: 'capacitor://localhost' } });
  expect(res.status).toBe(500);
  expect(res.body).toEqual({ error: expect.any(String), code: 'server' });
  expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  expect(res.headers.get('Cache-Control')).toBe('no-store');
});
