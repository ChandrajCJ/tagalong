import { createDb } from '@tagalong/db';
import type { AuthTokens } from '@tagalong/shared';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, beforeEach } from 'vitest';
import { buildApp } from '../src/app';
import { loadEnv } from '../src/env';
import type { Mailer } from '../src/lib/mailer';
import { loadTestEnv } from './load-env';

/** Captures sign-in codes instead of sending them. */
export const captureMailer = () => {
  const codes = new Map<string, string>();
  const mailer: Mailer = {
    async sendLoginCode(email, code) {
      codes.set(email, code);
    },
  };
  return { mailer, codes };
};

/** Builds a fresh app per test file and empties the database before each test. */
export const useTestApp = () => {
  const ctx = {} as {
    app: FastifyInstance;
    codes: Map<string, string>;
    signIn: (email: string) => Promise<AuthTokens>;
  };
  let cleanup: () => Promise<void>;
  let truncate: () => Promise<unknown>;

  beforeAll(async () => {
    loadTestEnv();
    const env = loadEnv();
    const { db, close } = createDb(env.DATABASE_URL, { max: 2 });
    const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
    const { mailer, codes } = captureMailer();
    const app = await buildApp({ env, db, redis, mailer });

    ctx.app = app;
    ctx.codes = codes;
    ctx.signIn = async (email) => {
      await app.inject({ method: 'POST', url: '/auth/email/request-code', payload: { email } });
      const res = await app.inject({
        method: 'POST',
        url: '/auth/email/verify',
        payload: { email, code: codes.get(email) },
      });
      if (res.statusCode !== 200) throw new Error(`Sign-in failed: ${res.body}`);
      return res.json<AuthTokens>();
    };
    truncate = () =>
      db.execute(
        sql`truncate identity.users, identity.login_codes, trips.trips, sync.change_log restart identity cascade`,
      );
    cleanup = async () => {
      await app.close();
      redis.disconnect();
      await close();
    };
  });

  beforeEach(async () => {
    ctx.codes.clear();
    await truncate();
  });

  afterAll(async () => cleanup?.());

  return ctx;
};

export const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
