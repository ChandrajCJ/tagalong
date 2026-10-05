import { newId, type ChatMessage, type MessagePage } from '@tagalong/shared';
import { describe, expect, it } from 'vitest';
import { bearer, createTrip, joinTrip, useTestApp } from './helpers';

describe('trip chat', () => {
  const t = useTestApp();

  const send = (token: string, tripId: string, body: string, id?: string) =>
    t.app.inject({
      method: 'POST',
      url: `/trips/${tripId}/messages`,
      headers: bearer(token),
      payload: { body, ...(id ? { id } : {}) },
    });
  const page = async (token: string, tripId: string, query = '') => {
    const res = await t.app.inject({
      method: 'GET',
      url: `/trips/${tripId}/messages${query}`,
      headers: bearer(token),
    });
    return { status: res.statusCode, body: res.json<MessagePage>() };
  };

  it('sends a message, lists it newest first, and asks to notify the others', async () => {
    const owner = await t.signIn('owner@example.com');
    const tripId = await createTrip(t.app, owner.accessToken);
    const sam = await joinTrip(t, tripId, owner.accessToken, 'sam@example.com');
    t.notified.length = 0;

    const first = await send(owner.accessToken, tripId, 'Boat tour Friday at 6?');
    expect(first.statusCode).toBe(201);
    expect(first.json()).toMatchObject({ kind: 'text', senderName: 'owner', body: 'Boat tour Friday at 6?' });
    await send(sam.accessToken, tripId, "I'm in");

    const { body } = await page(owner.accessToken, tripId);
    const texts = body.messages.filter((m) => m.kind === 'text').map((m) => m.body);
    expect(texts).toEqual(["I'm in", 'Boat tour Friday at 6?']);

    // Each message asks to notify everyone except its sender.
    expect(t.notified).toEqual([
      { tripId, userId: sam.userId },
      { tripId, userId: expect.any(String) },
    ]);
    expect(t.notified[1]!.userId).not.toBe(sam.userId);
  });

  it('posts activity cards when someone joins or adds to the plan', async () => {
    const owner = await t.signIn('owner@example.com');
    const tripId = await createTrip(t.app, owner.accessToken);
    await joinTrip(t, tripId, owner.accessToken, 'riya@example.com');
    await t.app.inject({
      method: 'POST',
      url: `/trips/${tripId}/items`,
      headers: bearer(owner.accessToken),
      payload: { title: 'Sunset at Chapora Fort' },
    });

    const { body } = await page(owner.accessToken, tripId);
    const cards = body.messages.filter((m) => m.kind === 'system').map((m) => m.body);
    expect(cards).toEqual(['owner added “Sunset at Chapora Fort” to the plan', 'riya joined the trip']);
    // Activity cards never trigger push notifications.
    expect(t.notified).toHaveLength(0);
  });

  it('pages back through history with a cursor', async () => {
    const owner = await t.signIn('owner@example.com');
    const tripId = await createTrip(t.app, owner.accessToken);
    for (let i = 1; i <= 5; i++) await send(owner.accessToken, tripId, `message ${i}`);

    const one = await page(owner.accessToken, tripId, '?limit=2');
    expect(one.body.messages.map((m) => m.body)).toEqual(['message 5', 'message 4']);
    const two = await page(owner.accessToken, tripId, `?limit=2&before=${one.body.nextCursor}`);
    expect(two.body.messages.map((m) => m.body)).toEqual(['message 3', 'message 2']);
    const three = await page(owner.accessToken, tripId, `?limit=2&before=${two.body.nextCursor}`);
    expect(three.body.messages.map((m) => m.body)).toEqual(['message 1']);
    expect(three.body.nextCursor).toBeNull();
  });

  it('treats a resend with the same id as one message', async () => {
    const owner = await t.signIn('owner@example.com');
    const tripId = await createTrip(t.app, owner.accessToken);
    const id = newId();
    expect((await send(owner.accessToken, tripId, 'hello', id)).statusCode).toBe(201);
    expect((await send(owner.accessToken, tripId, 'hello', id)).statusCode).toBe(200);
    const { body } = await page(owner.accessToken, tripId);
    expect(body.messages.filter((m) => m.kind === 'text')).toHaveLength(1);
  });

  it('keeps strangers out and lets viewers read but not post', async () => {
    const owner = await t.signIn('owner@example.com');
    const tripId = await createTrip(t.app, owner.accessToken);
    await send(owner.accessToken, tripId, 'Private plans');
    const stranger = await t.signIn('stranger@example.com');
    const viewer = await joinTrip(t, tripId, owner.accessToken, 'mom@example.com', 'viewer');

    expect((await page(stranger.accessToken, tripId)).status).toBe(404);
    expect((await send(stranger.accessToken, tripId, 'hi')).statusCode).toBe(404);
    expect((await page(viewer.accessToken, tripId)).status).toBe(200);
    expect((await send(viewer.accessToken, tripId, 'hi')).statusCode).toBe(403);
  });

  it('toggles reactions', async () => {
    const owner = await t.signIn('owner@example.com');
    const tripId = await createTrip(t.app, owner.accessToken);
    const sam = await joinTrip(t, tripId, owner.accessToken, 'sam@example.com');
    const message = (await send(owner.accessToken, tripId, 'Booked the boat')).json<ChatMessage>();
    const react = (token: string, emoji: string) =>
      t.app.inject({
        method: 'POST',
        url: `/messages/${message.id}/reactions`,
        headers: bearer(token),
        payload: { emoji },
      });

    await react(owner.accessToken, '🎉');
    const both = await react(sam.accessToken, '🎉');
    expect(both.json().reactions).toEqual([{ emoji: '🎉', count: 2, mine: true }]);

    const undone = await react(sam.accessToken, '🎉');
    expect(undone.json().reactions).toEqual([{ emoji: '🎉', count: 1, mine: false }]);
    expect((await react(sam.accessToken, '💩')).statusCode).toBe(400);
  });

  it('moves read markers forward only', async () => {
    const owner = await t.signIn('owner@example.com');
    const tripId = await createTrip(t.app, owner.accessToken);
    const sam = await joinTrip(t, tripId, owner.accessToken, 'sam@example.com');
    const older = (await send(owner.accessToken, tripId, 'one')).json<ChatMessage>();
    const newer = (await send(owner.accessToken, tripId, 'two')).json<ChatMessage>();
    const read = (messageId: string) =>
      t.app.inject({
        method: 'POST',
        url: `/trips/${tripId}/read`,
        headers: bearer(sam.accessToken),
        payload: { messageId },
      });

    await read(newer.id);
    const back = await read(older.id);
    expect(back.json().lastReadAt).toBe(newer.createdAt);

    const { body } = await page(owner.accessToken, tripId);
    expect(body.readStates).toContainEqual({ userId: sam.userId, lastReadAt: newer.createdAt });
  });
});
