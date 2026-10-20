import { createDb, type Db } from '@tagalong/db';
import type { AuthTokens } from '@tagalong/shared';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, beforeEach } from 'vitest';
import { buildApp } from '../src/app';
import { loadEnv } from '../src/env';
import type { Rates } from '../src/lib/fx';
import type { Geo } from '../src/lib/geo';
import type { Jobs } from '../src/lib/jobs';
import type { Mailer } from '../src/lib/mailer';
import type { Routing } from '../src/lib/routing';
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
    /** Immediate pushes asked for because someone was @mentioned. */
    mentioned: { tripId: string; messageId: string; userId: string }[];
    /** Messages the API asked the worker to fetch a link preview for. */
    previews: string[];
    /** Plan, money, to-do and trip pushes asked for. */
    activity: { kind: string; tripId: string; userId: string }[];
    /** The fake storage's contents, so tests can play the worker's part. */
    storage: Storage;
    signIn: (email: string) => Promise<AuthTokens>;
    /** Exchange rates the fake rates service answers with, as "USD:EUR" → rate. */
    fx: Map<string, number>;
    /** The fake map-data service: set what it answers, and see what it was asked. */
    geo: FakeGeo;
    /** The fake router: straight lines at 1 m/s, or down when `routing.down` is set. */
    routing: FakeRouting;
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
    const mentioned: { tripId: string; messageId: string; userId: string }[] = [];
    const previews: string[] = [];
    const activity: { kind: string; tripId: string; userId: string }[] = [];
    const jobs: Jobs = {
      async notifyActivity(kind, tripId, userIds) {
        activity.push(...userIds.map((userId) => ({ kind, tripId, userId })));
      },
      async notifyMention(tripId, messageId, userIds) {
        mentioned.push(...userIds.map((userId) => ({ tripId, messageId, userId })));
      },
      async linkPreview(messageId) {
        previews.push(messageId);
      },
      async notifyChat(tripId, userIds) {
        notified.push(...userIds.map((userId) => ({ tripId, userId })));
      },
      async makeThumbnail(photoId) {
        thumbnails.push(photoId);
      },
      async close() {},
    };
    const { storage, putObject } = fakeStorage();
    // Never the real rates service: tests mustn't depend on the network or today's rates.
    const fx = new Map<string, number>();
    const rates: Rates = {
      async quote(from, to) {
        const rate = from === to ? 1 : fx.get(`${from}:${to}`);
        return rate ? { from, to, rate, date: '2026-06-12' } : null;
      },
    };
    const geo = fakeGeo();
    const routing = fakeRouting();
    const app = await buildApp({ env, db, redis, mailer, jobs, storage, rates, geo, routing });

    ctx.app = app;
    ctx.db = db;
    ctx.redis = redis;
    ctx.codes = codes;
    ctx.notified = notified;
    ctx.putObject = putObject;
    ctx.thumbnails = thumbnails;
    ctx.mentioned = mentioned;
    ctx.previews = previews;
    ctx.activity = activity;
    ctx.storage = storage;
    ctx.fx = fx;
    ctx.geo = geo;
    ctx.routing = routing;
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
    ctx.mentioned.length = 0;
    ctx.previews.length = 0;
    ctx.activity.length = 0;
    await ctx.redis.eval("for _, k in ipairs(redis.call('keys', 'activity:*')) do redis.call('del', k) end", 0);
    ctx.fx.clear();
    ctx.geo.reset();
    ctx.routing.reset();
    await ctx.redis.eval("for _, k in ipairs(redis.call('keys', 'geo:*')) do redis.call('del', k) end", 0);
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

/** Map data without the network: answers come from `answers`, and every call is counted. */
export type FakeGeo = Geo & {
  answers: {
    search: Awaited<ReturnType<Geo['search']>>;
    wiki: Awaited<ReturnType<Geo['wikipediaNearby']>> | null;
    osm: Awaited<ReturnType<Geo['osmPlaces']>>;
    photon: Awaited<ReturnType<Geo['photonPlaces']>>;
    weather: Awaited<ReturnType<Geo['weather']>>;
    timezone: string | null;
    photo: Awaited<ReturnType<Geo['destinationPhoto']>>;
    /** What a Wikipedia image download returns. */
    image: { contentType: string; body: Buffer } | null;
  };
  calls: string[];
  /** Every search, with how it was asked. */
  searches: ({ query: string } & NonNullable<Parameters<Geo['search']>[1]>)[];
  /** Where weather and Wikipedia were asked about, as "weather@lat,lng:from:to" and "wiki@lat,lng". */
  spots: string[];
  reset(): void;
};

export const fakeGeo = (): FakeGeo => {
  const fresh = (): FakeGeo['answers'] => ({
    search: [],
    wiki: [],
    osm: [],
    photon: [],
    weather: { timezone: 'Asia/Kolkata', days: [] },
    timezone: 'Asia/Kolkata',
    photo: null,
    image: null,
  });
  const geo: FakeGeo = {
    answers: fresh(),
    calls: [],
    searches: [],
    spots: [],
    reset() {
      geo.answers = fresh();
      geo.calls.length = 0;
      geo.searches.length = 0;
      geo.spots.length = 0;
    },
    async search(query, options) {
      geo.calls.push(`search:${query}`);
      geo.searches.push({ query, ...options });
      return geo.answers.search;
    },
    async wikipediaNearby(point) {
      geo.calls.push('wiki');
      geo.spots.push(`wiki@${point.latitude},${point.longitude}`);
      if (geo.answers.wiki === null) throw new Error('Wikipedia is down');
      return geo.answers.wiki;
    },
    async osmPlaces(_bounds, category) {
      geo.calls.push(`osm:${category}`);
      return geo.answers.osm;
    },
    async photonPlaces(_bounds, category) {
      geo.calls.push(`photon:${category}`);
      return geo.answers.photon;
    },
    async weather(centre, kind, from, to) {
      geo.calls.push(`weather:${kind}:${from}:${to}`);
      geo.spots.push(`weather@${centre.latitude},${centre.longitude}:${from}:${to}`);
      return geo.answers.weather;
    },
    async timezoneAt() {
      geo.calls.push('timezone');
      return geo.answers.timezone;
    },
    async destinationPhoto(name) {
      geo.calls.push(`photo:${name}`);
      return geo.answers.photo;
    },
    async fetchImage(url) {
      geo.calls.push(`image:${url}`);
      if (!geo.answers.image) throw new Error('No image');
      return geo.answers.image;
    },
  };
  return geo;
};

/** A router without the network: each leg is a straight line, one metre per second. */
export type FakeRouting = Routing & { calls: string[]; down: boolean; reset(): void };

export const fakeRouting = (): FakeRouting => {
  const straight = (a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) =>
    Math.round(Math.hypot(a.latitude - b.latitude, a.longitude - b.longitude) * 111_000);
  const routing: FakeRouting = {
    calls: [],
    down: false,
    reset() {
      routing.calls.length = 0;
      routing.down = false;
    },
    async route(mode, points) {
      routing.calls.push(`route:${mode}:${points.length}`);
      if (routing.down) throw new Error('Routing is down');
      return {
        legs: points.slice(1).map((p, i) => ({ distanceM: straight(points[i]!, p), durationS: straight(points[i]!, p) })),
        geometry: { type: 'LineString', coordinates: points.map((p) => [p.longitude, p.latitude]) },
      };
    },
    async table(mode, points) {
      routing.calls.push(`table:${mode}:${points.length}`);
      if (routing.down) throw new Error('Routing is down');
      return { durations: points.map((a) => points.map((b) => straight(a, b))) };
    },
  };
  return routing;
};
