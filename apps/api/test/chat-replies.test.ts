import type { ChatMessage, ItineraryItem, MessagePage } from '@tagalong/shared';
import { describe, expect, it } from 'vitest';
import { bearer, createTrip, joinTrip, useTestApp } from './helpers';

describe('replying to a message', () => {
  const t = useTestApp();

  const send = (token: string, url: string, body: string, replyToId?: string) =>
    t.app.inject({ method: 'POST', url, headers: bearer(token), payload: { body, ...(replyToId ? { replyToId } : {}) } });

  it('shows what was replied to, both when sent and in the history', async () => {
    const owner = await t.signIn('owner@example.com');
    const tripId = await createTrip(t.app, owner.accessToken);
    const sam = await joinTrip(t, tripId, owner.accessToken, 'sam@example.com');
    const question = (await send(owner.accessToken, `/trips/${tripId}/messages`, 'Boat tour Friday at 6?')).json<ChatMessage>();

    const reply = await send(sam.accessToken, `/trips/${tripId}/messages`, "I'm in", question.id);
    expect(reply.statusCode).toBe(201);
    expect(reply.json<ChatMessage>().replyTo).toEqual({
      id: question.id,
      senderName: 'owner',
      body: 'Boat tour Friday at 6?',
      deleted: false,
    });

    const page = await t.app.inject({ method: 'GET', url: `/trips/${tripId}/messages`, headers: bearer(owner.accessToken) });
    const listed = page.json<MessagePage>().messages.find((m) => m.body === "I'm in");
    expect(listed?.replyTo).toMatchObject({ id: question.id, body: 'Boat tour Friday at 6?' });
  });

  it('shortens a long original to a preview', async () => {
    const owner = await t.signIn('owner@example.com');
    const tripId = await createTrip(t.app, owner.accessToken);
    const long = (await send(owner.accessToken, `/trips/${tripId}/messages`, 'x'.repeat(500))).json<ChatMessage>();
    const reply = (await send(owner.accessToken, `/trips/${tripId}/messages`, 'agreed', long.id)).json<ChatMessage>();
    expect(reply.replyTo!.body.length).toBeLessThanOrEqual(140);
    expect(reply.replyTo!.body.endsWith('…')).toBe(true);
  });

  it('only replies to messages in the same chat', async () => {
    const owner = await t.signIn('owner@example.com');
    const tripId = await createTrip(t.app, owner.accessToken);
    const otherTrip = await createTrip(t.app, owner.accessToken, 'Porto');
    const elsewhere = (await send(owner.accessToken, `/trips/${otherTrip}/messages`, 'secret')).json<ChatMessage>();
    expect((await send(owner.accessToken, `/trips/${tripId}/messages`, 'hm', elsewhere.id)).statusCode).toBe(400);

    // A plan item's thread is a different conversation from the main chat.
    const item = (
      await t.app.inject({ method: 'POST', url: `/trips/${tripId}/items`, headers: bearer(owner.accessToken), payload: { title: 'Dinner' } })
    ).json<ItineraryItem>();
    const inThread = (await send(owner.accessToken, `/items/${item.id}/messages`, 'Book for 8?')).json<ChatMessage>();
    expect((await send(owner.accessToken, `/trips/${tripId}/messages`, 'yes', inThread.id)).statusCode).toBe(400);
    expect((await send(owner.accessToken, `/items/${item.id}/messages`, 'yes', inThread.id)).statusCode).toBe(201);
  });
});
