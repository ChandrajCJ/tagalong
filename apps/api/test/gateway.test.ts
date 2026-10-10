import { createDb } from '@tagalong/db';
import { CLIENT_ID_HEADER, type ServerMessage } from '@tagalong/shared';
import type { FastifyInstance } from 'fastify';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { loadEnv } from '../src/env';
import { buildGateway } from '../src/realtime/gateway';
import { bearer, createTrip, joinTrip, useTestApp } from './helpers';

/** A test client that records everything the gateway sends it. */
const connect = (port: number, token: string, clientId?: string) =>
  new Promise<{ ws: WebSocket; messages: ServerMessage[]; closed: Promise<number> }>((resolve, reject) => {
    const query = new URLSearchParams({ token, ...(clientId ? { clientId } : {}) });
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?${query}`);
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

describe('realtime gateway', () => {
  const t = useTestApp();
  let gateway: FastifyInstance;
  let port: number;
  let cleanup: () => Promise<void>;

  beforeAll(async () => {
    const env = loadEnv();
    const { db, close } = createDb(env.DATABASE_URL, { max: 2 });
    const redis = new Redis(env.REDIS_URL);
    const subscriber = new Redis(env.REDIS_URL);
    gateway = await buildGateway({ env, db, redis, subscriber });
    await gateway.listen({ host: '127.0.0.1', port: 0 });
    port = (gateway.server.address() as { port: number }).port;
    cleanup = async () => {
      await gateway.close();
      redis.disconnect();
      subscriber.disconnect();
      await close();
    };
  });
  afterAll(async () => cleanup?.());

  it('closes connections without a valid sign-in', async () => {
    const client = await connect(port, 'not-a-token');
    expect(await client.closed).toBe(4401);
  });

  it("won't subscribe a non-member to a trip", async () => {
    const owner = await t.signIn('owner@example.com');
    const tripId = await createTrip(t.app, owner.accessToken);
    const stranger = await t.signIn('stranger@example.com');

    const client = await connect(port, stranger.accessToken);
    client.ws.send(JSON.stringify({ op: 'subscribe', tripId }));
    const error = await waitFor(() => client.messages.find((m) => m.kind === 'error'));
    expect(error).toMatchObject({ code: 'not_found', tripId });
    client.ws.close();
  });

  it("delivers a member's change to everyone, its sender's phone included, marked as theirs", async () => {
    const owner = await t.signIn('owner@example.com');
    const tripId = await createTrip(t.app, owner.accessToken);
    const sam = await joinTrip(t, tripId, owner.accessToken, 'sam@example.com');

    const ownerClient = await connect(port, owner.accessToken, 'owner-phone-0001');
    const samClient = await connect(port, sam.accessToken, 'sam-phone-00001');
    for (const c of [ownerClient, samClient]) {
      c.ws.send(JSON.stringify({ op: 'subscribe', tripId }));
      await waitFor(() => c.messages.find((m) => m.kind === 'subscribed'));
    }

    // The owner adds an item from the phone connected as owner-phone-0001.
    const res = await t.app.inject({
      method: 'POST',
      url: `/trips/${tripId}/items`,
      headers: { ...bearer(owner.accessToken), [CLIENT_ID_HEADER]: 'owner-phone-0001' },
      payload: { title: 'Sunset boat tour' },
    });
    const itemId = res.json().id;

    const received = await waitFor(() =>
      samClient.messages.find((m) => m.kind === 'event' && m.event.entityId === itemId),
    );
    expect(received).toMatchObject({ event: { type: 'item.upserted', payload: { title: 'Sunset boat tour' } } });

    // The sender's phone gets it too: its other screens need it (the Plan tab
    // didn't hear about an idea moved into the plan from the Ideas tab).
    const own = await waitFor(() =>
      ownerClient.messages.find((m) => m.kind === 'event' && m.event.entityId === itemId),
    );
    expect(own).toMatchObject({ event: { originClientId: 'owner-phone-0001' } });

    ownerClient.ws.close();
    samClient.ws.close();
  });

  it('relays "is editing" to others without saving it', async () => {
    const owner = await t.signIn('owner@example.com');
    const tripId = await createTrip(t.app, owner.accessToken);
    const sam = await joinTrip(t, tripId, owner.accessToken, 'sam@example.com');
    const item = (
      await t.app.inject({
        method: 'POST',
        url: `/trips/${tripId}/items`,
        headers: bearer(owner.accessToken),
        payload: { title: 'Dinner' },
      })
    ).json();

    const ownerClient = await connect(port, owner.accessToken);
    const samClient = await connect(port, sam.accessToken);
    for (const c of [ownerClient, samClient]) {
      c.ws.send(JSON.stringify({ op: 'subscribe', tripId }));
      await waitFor(() => c.messages.find((m) => m.kind === 'subscribed'));
    }

    samClient.ws.send(JSON.stringify({ op: 'editing', tripId, itemId: item.id }));
    const presence = await waitFor(() => ownerClient.messages.find((m) => m.kind === 'presence'));
    expect(presence).toMatchObject({ presence: { itemId: item.id, displayName: 'sam' } });

    // Sam's phone drops off: everyone hears that Sam stopped editing.
    samClient.ws.close();
    await waitFor(() =>
      ownerClient.messages.find((m) => m.kind === 'presence' && m.presence.itemId === null),
    );
    ownerClient.ws.close();
  });

  it('relays "is typing" to the others only', async () => {
    const owner = await t.signIn('owner@example.com');
    const tripId = await createTrip(t.app, owner.accessToken);
    const sam = await joinTrip(t, tripId, owner.accessToken, 'sam@example.com');
    const ownerClient = await connect(port, owner.accessToken);
    const samClient = await connect(port, sam.accessToken);
    for (const c of [ownerClient, samClient]) {
      c.ws.send(JSON.stringify({ op: 'subscribe', tripId }));
      await waitFor(() => c.messages.find((m) => m.kind === 'subscribed'));
    }

    samClient.ws.send(JSON.stringify({ op: 'typing', tripId }));
    const typing = await waitFor(() => ownerClient.messages.find((m) => m.kind === 'typing'));
    expect(typing).toMatchObject({ typing: { tripId, displayName: 'sam' } });
    await new Promise((r) => setTimeout(r, 100));
    expect(samClient.messages.some((m) => m.kind === 'typing')).toBe(false);
    ownerClient.ws.close();
    samClient.ws.close();
  });

  it('stops sending a trip to someone who was removed', async () => {
    const owner = await t.signIn('owner@example.com');
    const tripId = await createTrip(t.app, owner.accessToken);
    const sam = await joinTrip(t, tripId, owner.accessToken, 'sam@example.com');

    const samClient = await connect(port, sam.accessToken);
    samClient.ws.send(JSON.stringify({ op: 'subscribe', tripId }));
    await waitFor(() => samClient.messages.find((m) => m.kind === 'subscribed'));

    await t.app.inject({
      method: 'DELETE',
      url: `/trips/${tripId}/members/${sam.userId}`,
      headers: bearer(owner.accessToken),
    });
    await waitFor(() => samClient.messages.find((m) => m.kind === 'error' && m.code === 'removed'));

    await t.app.inject({
      method: 'POST',
      url: `/trips/${tripId}/items`,
      headers: bearer(owner.accessToken),
      payload: { title: 'Private now' },
    });
    await new Promise((r) => setTimeout(r, 150));
    expect(
      samClient.messages.some((m) => m.kind === 'event' && m.event.type === 'item.upserted'),
    ).toBe(false);
    samClient.ws.close();
  });
});
