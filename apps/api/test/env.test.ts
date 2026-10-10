import { describe, expect, it } from 'vitest';
import { loadEnv } from '../src/env';

const base = {
  DATABASE_URL: 'postgres://u:p@db:5432/tagalong',
  REDIS_URL: 'redis://redis:6379',
  JWT_SECRET: 'change-me-to-a-long-random-string',
};

const production = {
  ...base,
  NODE_ENV: 'production',
  JWT_SECRET: 'a'.repeat(64),
  SMTP_URL: 'smtps://me%40gmail.com:app-password@smtp.gmail.com:465',
  S3_SECRET_KEY: 'b'.repeat(40),
  CORS_ORIGINS: 'https://app.example.com',
};

describe('environment', () => {
  it('runs on development defaults locally', () => {
    expect(() => loadEnv(base)).not.toThrow();
  });

  it('refuses to start in production on development defaults', () => {
    expect(() => loadEnv({ ...base, NODE_ENV: 'production' })).toThrow(
      /SMTP_URL[\s\S]*JWT_SECRET[\s\S]*S3_SECRET_KEY[\s\S]*CORS_ORIGINS/,
    );
  });

  it('starts in production once everything is set', () => {
    expect(loadEnv(production)).toMatchObject({ NODE_ENV: 'production', CORS_ORIGINS: 'https://app.example.com' });
  });

  it('only lets listed websites call the API in production', async () => {
    const { buildApp } = await import('../src/app');
    const { createDb } = await import('@tagalong/db');
    const { Redis } = await import('ioredis');
    const { loadTestEnv } = await import('./load-env');
    loadTestEnv();
    const env = { ...loadEnv(), CORS_ORIGINS: 'https://app.example.com' };
    const { db, close } = createDb(env.DATABASE_URL, { max: 1 });
    const redis = new Redis(env.REDIS_URL);
    const app = await buildApp({ env, db, redis });
    const ask = (origin: string) =>
      app.inject({ method: 'OPTIONS', url: '/health', headers: { origin, 'access-control-request-method': 'GET' } });
    expect((await ask('https://app.example.com')).headers['access-control-allow-origin']).toBe('https://app.example.com');
    expect((await ask('https://evil.example')).headers['access-control-allow-origin']).toBeUndefined();
    await app.close();
    redis.disconnect();
    await close();
  });
});
