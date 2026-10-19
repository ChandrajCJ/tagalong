import { messages } from '@tagalong/db';
import type { ChatMessage, ItineraryItem, MessagePage, MyTrips, TripEvent } from '@tagalong/shared';
import { eq } from 'drizzle-orm';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, createTrip, joinTrip, useTestApp } from './helpers';

describe('editing and deleting messages', () => {
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

  const send = async (token: string, tripId: string, body: string, replyToId?: string) =>
    (
      await t.app.inject({
        method: 'POST',
        url: `/trips/${tripId}/messages`,
        headers: bearer(token),
        payload: { body, ...(replyToId ? { replyToId } : {}) },
      })
    ).json<ChatMessage>();
  const edit = (token: string, id: string, body: string) =>
    t.app.inject({ method: 'PATCH', url: `/messages/${id}`, headers: bearer(token), payload: { body } });
  const remove = (token: string, id: string) =>
    t.app.inject({ method: 'DELETE', url: `/messages/${id}`, headers: bearer(token) });
  const history = async (token: string, tripId: string) =>
    (await t.app.inject({ method: 'GET', url: `/trips/${tripId}/messages`, headers: bearer(token) })).json<MessagePage>().messages;

  describe('edit', () => {
    it('lets the sender fix their message, and tells everyone', async () => {
      const { sam, alex, tripId } = await setup();
      const message = await send(sam.accessToken, tripId, 'Dinner at 8?');
      events.length = 0;

      const res = await edit(sam.accessToken, message.id, 'Dinner at 9?');
      expect(res.statusCode).toBe(200);
      expect(res.json<ChatMessage>()).toMatchObject({ body: 'Dinner at 9?', editedAt: expect.any(String) });
      expect((await heard('message.updated')).map((e) => (e.payload as ChatMessage).body)).toEqual(['Dinner at 9?']);

      const listed = (await history(alex.accessToken, tripId)).find((m) => m.id === message.id);
      expect(listed).toMatchObject({ body: 'Dinner at 9?', editedAt: expect.any(String) });
    });

    it('is the sender’s alone, even for an owner', async () => {
      const { owner, sam, tripId } = await setup();
      const message = await send(sam.accessToken, tripId, 'Dinner at 8?');
      expect((await edit(owner.accessToken, message.id, 'nope')).statusCode).toBe(403);
    });

    it('closes 24 hours after sending', async () => {
      const { sam, tripId } = await setup();
      const message = await send(sam.accessToken, tripId, 'Dinner at 8?');
      await t.db
        .update(messages)
        .set({ createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000) })
        .where(eq(messages.id, message.id));
      expect((await edit(sam.accessToken, message.id, 'Dinner at 9?')).statusCode).toBe(403);
    });

    it('works on text only, not polls or activity cards', async () => {
      const { owner, tripId } = await setup();
      const poll = await t.app.inject({
        method: 'POST',
        url: `/trips/${tripId}/polls`,
        headers: bearer(owner.accessToken),
        payload: { question: 'Where?', options: ['Here', 'There'] },
      });
      expect((await edit(owner.accessToken, poll.json<ChatMessage>().id, 'Why?')).statusCode).toBe(400);

      const card = (await history(owner.accessToken, tripId)).find((m) => m.kind === 'system')!;
      expect((await edit(owner.accessToken, card.id, 'hm')).statusCode).toBe(403);
    });
  });

  describe('delete', () => {
    it('lets the sender delete their own, leaving a placeholder without the text', async () => {
      const { sam, alex, tripId } = await setup();
      const message = await send(sam.accessToken, tripId, 'my passport number is 123');
      events.length = 0;

      expect((await remove(alex.accessToken, message.id)).statusCode).toBe(403);
      expect((await remove(sam.accessToken, message.id)).statusCode).toBe(204);
      expect((await heard('message.deleted')).map((e) => e.payload)).toEqual([{ messageId: message.id, itemId: null }]);

      const listed = (await history(alex.accessToken, tripId)).find((m) => m.id === message.id);
      expect(listed).toMatchObject({ body: '', payload: null, deletedAt: expect.any(String) });
      const [row] = await t.db.select().from(messages).where(eq(messages.id, message.id));
      expect(row?.body).toBe('');

      // Gone means gone: no editing it back, and deleting again is harmless.
      expect((await edit(sam.accessToken, message.id, 'back')).statusCode).toBe(404);
      expect((await remove(sam.accessToken, message.id)).statusCode).toBe(204);
    });

    it('lets a trip owner delete anyone’s message', async () => {
      const { owner, sam, tripId } = await setup();
      const message = await send(sam.accessToken, tripId, 'spam');
      expect((await remove(owner.accessToken, message.id)).statusCode).toBe(204);
    });

    it('keeps activity cards', async () => {
      const { owner, tripId } = await setup();
      const card = (await history(owner.accessToken, tripId)).find((m) => m.kind === 'system')!;
      expect((await remove(owner.accessToken, card.id)).statusCode).toBe(403);
    });

    it('shows replies to it as quoting a deleted message', async () => {
      const { sam, alex, tripId } = await setup();
      const original = await send(sam.accessToken, tripId, 'Boat at 6?');
      const reply = await send(alex.accessToken, tripId, 'yes!', original.id);
      await remove(sam.accessToken, original.id);
      const listed = (await history(alex.accessToken, tripId)).find((m) => m.id === reply.id);
      expect(listed?.replyTo).toEqual({ id: original.id, senderName: 'sam', body: '', deleted: true });
    });

    it('says which thread the deleted message was in', async () => {
      const { sam, tripId } = await setup();
      const item = (
        await t.app.inject({ method: 'POST', url: `/trips/${tripId}/items`, headers: bearer(sam.accessToken), payload: { title: 'Dinner' } })
      ).json<ItineraryItem>();
      const inThread = (
        await t.app.inject({ method: 'POST', url: `/items/${item.id}/messages`, headers: bearer(sam.accessToken), payload: { body: 'Book?' } })
      ).json<ChatMessage>();
      events.length = 0;
      await remove(sam.accessToken, inThread.id);
      expect((await heard('message.deleted'))[0]?.payload).toEqual({ messageId: inThread.id, itemId: item.id });
    });
  });

  describe('unread counts', () => {
    const counts = async (token: string) =>
      Object.fromEntries(
        (await t.app.inject({ method: 'GET', url: '/trips', headers: bearer(token) }))
          .json<MyTrips>()
          .trips.map((x) => [x.name, x.unreadCount]),
      );
    const tabBadge = async (token: string, tripId: string) =>
      (await t.app.inject({ method: 'GET', url: `/trips/${tripId}/unread`, headers: bearer(token) })).json<{ chat: number }>().chat;

    it('counts others’ messages since I last read, but not mine or deleted ones', async () => {
      const { owner, sam, tripId } = await setup();
      // Joining posted cards ("sam joined the trip"); start from a clean slate.
      const newest = (await history(owner.accessToken, tripId))[0]!;
      await t.app.inject({ method: 'POST', url: `/trips/${tripId}/read`, headers: bearer(owner.accessToken), payload: { messageId: newest.id } });
      expect(await tabBadge(owner.accessToken, tripId)).toBe(0);

      // (Sending one of my own also marks everything before it as read.)
      await send(owner.accessToken, tripId, 'mine');
      await send(sam.accessToken, tripId, 'one');
      const two = await send(sam.accessToken, tripId, 'two');
      await send(sam.accessToken, tripId, 'three');
      expect(await tabBadge(owner.accessToken, tripId)).toBe(3);

      await remove(sam.accessToken, two.id);
      expect(await tabBadge(owner.accessToken, tripId)).toBe(2);
      expect((await counts(owner.accessToken)).Lisbon).toBe(2);

      // Reading resets it.
      const latest = (await history(owner.accessToken, tripId))[0]!;
      await t.app.inject({ method: 'POST', url: `/trips/${tripId}/read`, headers: bearer(owner.accessToken), payload: { messageId: latest.id } });
      expect(await tabBadge(owner.accessToken, tripId)).toBe(0);
    });

    it('counts from when I joined, not the whole history, and not cards about me', async () => {
      const owner = await t.signIn('owner@example.com');
      const tripId = await createTrip(t.app, owner.accessToken);
      await send(owner.accessToken, tripId, 'before you came');
      const sam = await joinTrip(t, tripId, owner.accessToken, 'sam@example.com');
      expect(await tabBadge(sam.accessToken, tripId)).toBe(0);
      await send(owner.accessToken, tripId, 'welcome!');
      expect(await tabBadge(sam.accessToken, tripId)).toBe(1);
    });

    it('keeps each trip’s count to itself', async () => {
      const { owner, sam, tripId } = await setup();
      const porto = await createTrip(t.app, owner.accessToken, 'Porto');
      await joinTrip(t, porto, owner.accessToken, 'sam@example.com');
      const before = await counts(sam.accessToken);
      await send(owner.accessToken, tripId, 'Lisbon news');
      const after = await counts(sam.accessToken);
      expect(after.Lisbon).toBe(before.Lisbon! + 1);
      expect(after.Porto).toBe(before.Porto);
    });
  });
});
