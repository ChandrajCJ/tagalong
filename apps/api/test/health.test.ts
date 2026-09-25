import { describe, expect, it } from 'vitest';
import { useTestApp } from './helpers';

describe('GET /health', () => {
  const t = useTestApp();

  it('reports the database and Redis as ok', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', db: 'ok', redis: 'ok' });
  });

  it('returns a JSON 404 for unknown routes', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: 'not_found' });
  });
});
