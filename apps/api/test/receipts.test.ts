import type { ChatMessage, MessageInfo, MessagePage, TripEvent } from '@tagalong/shared';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, createTrip, joinTrip, useTestApp } from './helpers';

describe('delivered and read', () => {
  const t = useTestApp();

  let listener: Redis;
  const events: TripEvent[] = [];
  beforeAll(async () => {
    listener = new Redis(process.env.REDIS_URL!);
    await listener.psubscribe('trip:*');
    listener.on('pmessage', (_p, _c, raw) => events.push(JSON.parse(raw)));
  });
  afterAll(() => listener.disconnect());
  const heard = async (type: TripEvent['type']) => {
    await new Promise((r) => setTimeout(r, 100));
    return events.filter((e) => e.type === type);
  };

  const setup = async () => {
    const owner = await t.signIn('owner@example.com');
    const tripId = await createTrip(t.app, owner.accessToken);
    const sam = await joinTrip(t, tripId, owner.accessToken, 'sam@example.com');
    const alex = await joinTrip(t, tripId, owner.accessToken, 'alex@example.com');
    return { owner, sam, alex, tripId };
  };
  const send = async (token: string, tripId: string, body: string) =>
    (await t.app.inject({ method: 'POST', url: `/trips/${tripId}/messages`, headers: bearer(token), payload: { body } })).json<ChatMessage>();
  const delivered = (token: string, tripId: string, upTo: string) =>
    t.app.inject({ method: 'POST', url: `/trips/${tripId}/delivered`, headers: bearer(token), payload: { upTo } });
  const read = (token: string, tripId: string, messageId: string) =>
    t.app.inject({ method: 'POST', url: `/trips/${tripId}/read`, headers: bearer(token), payload: { messageId } });
  const info = async (token: string, messageId: string) =>
    (await t.app.inject({ method: 'GET', url: `/messages/${messageId}/info`, headers: bearer(token) })).json<MessageInfo>();
  const names = (list: { displayName: string }[]) => list.map((p) => p.displayName);
  const setReceipts = (token: string, readReceipts: boolean) =>
    t.app.inject({ method: 'PATCH', url: '/me', headers: bearer(token), payload: { readReceipts } });

  it('sorts people into read, delivered and not yet delivered', async () => {
    const { owner, sam, alex, tripId } = await setup();
    const message = await send(owner.accessToken, tripId, 'Boat at 6?');
    expect(names((await info(owner.accessToken, message.id)).notDelivered)).toEqual(['alex', 'sam']);

    events.length = 0;
    expect((await delivered(sam.accessToken, tripId, message.id)).statusCode).toBe(200);
    expect((await heard('delivery.updated')).map((e) => e.actorId)).toEqual([sam.userId]);
    await read(alex.accessToken, tripId, message.id);

    const result = await info(owner.accessToken, message.id);
    expect(names(result.readBy)).toEqual(['alex']);
    expect(names(result.deliveredTo)).toEqual(['sam']);
    expect(result.notDelivered).toEqual([]);
  });

  it('only moves forward, and a repeated ack changes nothing', async () => {
    const { owner, sam, tripId } = await setup();
    const first = await send(owner.accessToken, tripId, 'one');
    const second = await send(owner.accessToken, tripId, 'two');
    await delivered(sam.accessToken, tripId, second.id);
    await heard('delivery.updated');
    events.length = 0;
    const again = await delivered(sam.accessToken, tripId, second.id);
    const back = await delivered(sam.accessToken, tripId, first.id);
    expect(again.json()).toEqual(back.json());
    expect(await heard('delivery.updated')).toEqual([]);
    expect(names((await info(owner.accessToken, first.id)).deliveredTo)).toEqual(['sam']);
  });

  it('only counts people on the trip when it was sent, and not people who left', async () => {
    const { owner, alex, tripId } = await setup();
    const message = await send(owner.accessToken, tripId, 'early');
    await joinTrip(t, tripId, owner.accessToken, 'late@example.com');
    await t.app.inject({ method: 'DELETE', url: `/trips/${tripId}/members/${alex.userId}`, headers: bearer(alex.accessToken) });
    const result = await info(owner.accessToken, message.id);
    expect([...names(result.readBy), ...names(result.deliveredTo), ...names(result.notDelivered)]).toEqual(['sam']);
  });

  it('hides reads both ways when someone turns read receipts off', async () => {
    const { owner, sam, tripId } = await setup();
    const message = await send(owner.accessToken, tripId, 'seen?');
    await read(sam.accessToken, tripId, message.id);
    expect(names((await info(owner.accessToken, message.id)).readBy)).toEqual(['sam']);

    // Sam hides theirs: the owner only learns it arrived.
    expect((await setReceipts(sam.accessToken, false)).json()).toMatchObject({ readReceipts: false });
    const hidden = await info(owner.accessToken, message.id);
    expect(hidden.readBy).toEqual([]);
    expect(names(hidden.deliveredTo)).toEqual(['sam']);
    const page = await t.app.inject({ method: 'GET', url: `/trips/${tripId}/messages`, headers: bearer(owner.accessToken) });
    expect(page.json<MessagePage>().readStates.find((r) => r.userId === sam.userId)).toMatchObject({
      lastReadAt: null,
      readHidden: true,
      lastDeliveredAt: expect.any(String),
    });

    // And Sam no longer sees anyone else's reads.
    const reply = await send(sam.accessToken, tripId, 'yes');
    await read(owner.accessToken, tripId, reply.id);
    const samsView = await info(sam.accessToken, reply.id);
    expect(samsView).toMatchObject({ readsShown: false, readBy: [] });
    expect(names(samsView.deliveredTo)).toEqual(['owner']);
    const samsPage = await t.app.inject({ method: 'GET', url: `/trips/${tripId}/messages`, headers: bearer(sam.accessToken) });
    const states = samsPage.json<MessagePage>().readStates;
    expect(states.find((r) => r.userId !== sam.userId && r.lastReadAt !== null)).toBeUndefined();
    // Their own read state is still theirs to see.
    expect(states.find((r) => r.userId === sam.userId)?.lastReadAt).not.toBeNull();

    events.length = 0;
    await read(sam.accessToken, tripId, reply.id);
    const announced = (await heard('read.updated')).map((e) => e.payload as { lastReadAt: string | null });
    expect(announced.every((p) => p.lastReadAt === null)).toBe(true);
  });

  it('shows info to the sender only', async () => {
    const { owner, sam, tripId } = await setup();
    const message = await send(owner.accessToken, tripId, 'mine');
    const res = await t.app.inject({ method: 'GET', url: `/messages/${message.id}/info`, headers: bearer(sam.accessToken) });
    expect(res.statusCode).toBe(403);
  });

  it('gives members their join time, so the app can work out ticks', async () => {
    const { owner, tripId } = await setup();
    const trip = await t.app.inject({ method: 'GET', url: `/trips/${tripId}`, headers: bearer(owner.accessToken) });
    expect(trip.json<{ members: { joinedAt: string }[] }>().members.every((m) => !!m.joinedAt)).toBe(true);
  });
});
