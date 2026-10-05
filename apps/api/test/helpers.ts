import { createDb, type Db } from '@tagalong/db';
import type { AuthTokens } from '@tagalong/shared';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, beforeEach } from 'vitest';
import { buildApp } from '../src/app';
import { loadEnv } from '../src/env';
import type { Jobs } from '../src/lib/jobs';
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
    db: Db;
    redis: Redis;
    codes: Map<string, string>;
    /** Push notifications the API asked for, instead of real queue jobs. */
    notified: { tripId: string; userId: string }[];
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
    const notified: { tripId: string; userId: string }[] = [];
    const jobs: Jobs = {
      async notifyChat(tripId, userIds) {
        notified.push(...userIds.map((userId) => ({ tripId, userId })));
      },
      async close() {},
    };
    const app = await buildApp({ env, db, redis, mailer, jobs });

    ctx.app = app;
    ctx.db = db;
    ctx.redis = redis;
    ctx.codes = codes;
    ctx.notified = notified;
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
    ctx.notified.length = 0;
    await truncate();
  });

  afterAll(async () => cleanup?.());

  return ctx;
};

export const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

/** Creates a trip and returns its id. */
export const createTrip = async (app: FastifyInstance, token: string, name = 'Lisbon') => {
  const res = await app.inject({
    method: 'POST',
    url: '/trips',
    headers: bearer(token),
    payload: { name, destination: 'Lisbon, Portugal' },
  });
  if (res.statusCode !== 201) throw new Error(`Create trip failed: ${res.body}`);
  return res.json<{ id: string }>().id;
};

/** Signs in `email` and joins the trip through a fresh invite from `inviterToken`. */
export const joinTrip = async (
  ctx: ReturnType<typeof useTestApp>,
  tripId: string,
  inviterToken: string,
  email: string,
  role: 'editor' | 'viewer' = 'editor',
) => {
  const invite = await ctx.app.inject({
    method: 'POST',
    url: `/trips/${tripId}/invites`,
    headers: bearer(inviterToken),
    payload: { role },
  });
  const tokens = await ctx.signIn(email);
  const res = await ctx.app.inject({
    method: 'POST',
    url: `/invites/${invite.json().token}/accept`,
    headers: bearer(tokens.accessToken),
  });
  if (res.statusCode !== 200) throw new Error(`Join failed: ${res.body}`);
  const me = await ctx.app.inject({ method: 'GET', url: '/me', headers: bearer(tokens.accessToken) });
  return { ...tokens, userId: me.json<{ id: string }>().id };
};
