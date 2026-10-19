import { createDb } from '@tagalong/db';
import type { ServerMessage } from '@tagalong/shared';
import type { FastifyInstance } from 'fastify';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { buildCombined } from '../src/combined';
import { loadEnv } from '../src/env';
import { bearer, captureMailer, createTrip, fakeStorage, joinTrip, useTestApp } from './helpers';

const connect = (port: number, token: string) =>
  new Promise<{ ws: WebSocket; messages: ServerMessage[]; closed: Promise<number> }>((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?${new URLSearchParams({ token })}`);
    const messages: ServerMessage[] = [];
    const closed = new Promise<number>((r) => ws.on('close', (code) => r(code)));
    ws.on('message', (raw) => messages.push(JSON.parse(raw.toString())));
    ws.on('open', () => resolve({ ws, messages, closed }));
    ws.on('error', reject);
  });

const waitFor = async <T>(fn: () => T | undefined, ms = 2000): Promise<T> => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const value = fn();
    if (value) return value;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('Timed out waiting');
};

/** The one-server setup for Render's free plan: API and live updates on one port. */
describe('API and gateway in one server', () => {
  const t = useTestApp();
  let app: FastifyInstance;
  let port: number;
  let cleanup: () => Promise<void>;

  beforeAll(async () => {
    const env = loadEnv();
    const { db, close } = createDb(env.DATABASE_URL, { max: 2 });
    const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
    const subscriber = new Redis(env.REDIS_URL);
    app = await buildCombined({ env, db, redis, subscriber, mailer: captureMailer().mailer, storage: fakeStorage().storage });
    await app.listen({ host: '127.0.0.1', port: 0 });
    port = (app.server.address() as { port: number }).port;
    cleanup = async () => {
      await app.close();
      redis.disconnect();
      subscriber.disconnect();
      await close();
    };
  });
  afterAll(async () => cleanup?.());

  it("answers the API's health check, which covers the database and Redis", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    expect(await res.json()).toMatchObject({ status: 'ok', db: 'ok', redis: 'ok' });
  });

  it('refuses live updates without a valid sign-in', async () => {
    const client = await connect(port, 'not-a-token');
    expect(await client.closed).toBe(4401);
  });

  it("delivers a change made through the same server's API", async () => {
    const owner = await t.signIn('owner@example.com');
    const tripId = await createTrip(t.app, owner.accessToken);
    const sam = await joinTrip(t, tripId, owner.accessToken, 'sam@example.com');

    const client = await connect(port, sam.accessToken);
    client.ws.send(JSON.stringify({ op: 'subscribe', tripId }));
    await waitFor(() => client.messages.find((m) => m.kind === 'subscribed'));

    const res = await app.inject({
      method: 'POST',
      url: `/trips/${tripId}/items`,
      headers: bearer(owner.accessToken),
      payload: { title: 'Ferry to Fort Aguada' },
    });
    expect(res.statusCode).toBe(201);
    const itemId = res.json().id;

    const received = await waitFor(() => client.messages.find((m) => m.kind === 'event' && m.event.entityId === itemId));
    expect(received).toMatchObject({ event: { type: 'item.upserted', payload: { title: 'Ferry to Fort Aguada' } } });
    client.ws.close();
  });
});
