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
import type { Storage } from '../src/lib/storage';
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

/**
 * Storage without the storage: upload links are fake, and a file only "exists"
 * once a test says it was uploaded, which is what the real PUT would do.
 */
export const fakeStorage = () => {
  const objects = new Map<string, number>();
  const blobs = new Map<string, Buffer>();
  const storage: Storage = {
    async uploadUrl(key) {
      return `https://storage.test/upload/${encodeURIComponent(key)}`;
    },
    async downloadUrl(key, fileName) {
      return `https://storage.test/get/${encodeURIComponent(key)}?name=${encodeURIComponent(fileName)}`;
    },
    async sizeOf(key) {
      return objects.get(key) ?? null;
    },
    async read(key) {
      return blobs.get(key) ?? null;
    },
    async write(key, body) {
      blobs.set(key, body);
      objects.set(key, body.length);
    },
    async remove(key) {
      objects.delete(key);
      blobs.delete(key);
    },
  };
  /** Stands in for the phone's PUT to the signed URL. */
  const putObject = (uploadUrl: string, size = 1024, body?: Buffer) => {
    const key = decodeURIComponent(uploadUrl.split('/upload/')[1]!);
    objects.set(key, body?.length ?? size);
    if (body) blobs.set(key, body);
  };
  return { storage, objects, blobs, putObject };
};

/** Builds a fresh app per test file and empties the database before each test. */
export const useTestApp = () => {
  const ctx = {} as {
    app: FastifyInstance;
    db: Db;
    redis: Redis;
    codes: Map<string, string>;
    /** Stands in for the phone PUTting the file to the signed URL. */
    putObject: (uploadUrl: string, size?: number, body?: Buffer) => void;
    /** Push notifications the API asked for, instead of real queue jobs. */
    notified: { tripId: string; userId: string }[];
    /** Photos the API asked the worker to make thumbnails for. */
    thumbnails: string[];
    /** The fake storage's contents, so tests can play the worker's part. */
    storage: Storage;
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
    const thumbnails: string[] = [];
    const jobs: Jobs = {
      async notifyChat(tripId, userIds) {
        notified.push(...userIds.map((userId) => ({ tripId, userId })));
      },
      async makeThumbnail(photoId) {
        thumbnails.push(photoId);
      },
      async close() {},
    };
    const { storage, putObject } = fakeStorage();
    const app = await buildApp({ env, db, redis, mailer, jobs, storage });

    ctx.app = app;
    ctx.db = db;
    ctx.redis = redis;
    ctx.codes = codes;
    ctx.notified = notified;
    ctx.putObject = putObject;
    ctx.thumbnails = thumbnails;
    ctx.storage = storage;
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
    ctx.thumbnails.length = 0;
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
