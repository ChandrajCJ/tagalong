import type { Booking, ChatMessage, DocumentUpload, ItineraryItem, NextUp } from '@tagalong/shared';
import { describe, expect, it } from 'vitest';
import { bearer, createTrip, joinTrip, useTestApp } from './helpers';

const ctx = useTestApp();

const setup = async () => {
  const owner = await ctx.signIn('owner@example.com');
  const tripId = await createTrip(ctx.app, owner.accessToken);
  const editor = await joinTrip(ctx, tripId, owner.accessToken, 'editor@example.com', 'editor');
  const viewer = await joinTrip(ctx, tripId, owner.accessToken, 'viewer@example.com', 'viewer');
  return { owner, editor, viewer, tripId };
};

const addItem = async (tripId: string, token: string, title = 'Fly to Lisbon') => {
  const res = await ctx.app.inject({
    method: 'POST',
    url: `/trips/${tripId}/items`,
    headers: bearer(token),
    payload: { title, type: 'flight', date: '2026-06-12' },
  });
  expect(res.statusCode).toBe(201);
  return res.json<ItineraryItem>();
};

const inDays = (days: number, hour = 8) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(hour, 15, 0, 0);
  return d.toISOString();
};

const book = (tripId: string, token: string, body: Record<string, unknown> = {}) =>
  ctx.app.inject({
    method: 'POST',
    url: `/trips/${tripId}/bookings`,
    headers: bearer(token),
    payload: {
      type: 'flight',
      provider: 'TAP Air Portugal',
      reference: 'X7K2QP',
      startsAt: inDays(3),
      endsAt: inDays(3, 11),
      timezone: 'Europe/Lisbon',
      details: { flightNumber: 'TP1234', from: 'LHR', to: 'LIS', seats: '14A, 14B' },
      ...body,
    },
  });

describe('bookings', () => {
  it('saves a flight on a plan item, with its details, for everyone to see', async () => {
    const { owner, viewer, tripId } = await setup();
    const item = await addItem(tripId, owner.accessToken);

    const res = await book(tripId, owner.accessToken, { itemId: item.id });
    expect(res.statusCode).toBe(201);
    const booking = res.json<Booking>();
    expect(booking).toMatchObject({ itemId: item.id, reference: 'X7K2QP', timezone: 'Europe/Lisbon' });
    expect(booking.details).toMatchObject({ flightNumber: 'TP1234', seats: '14A, 14B' });

    const list = await ctx.app.inject({
      method: 'GET',
      url: `/trips/${tripId}/bookings`,
      headers: bearer(viewer.accessToken),
    });
    expect(list.json<{ bookings: Booking[] }>().bookings.map((b) => b.id)).toEqual([booking.id]);
  });

  it('refuses details that belong to a different kind of booking', async () => {
    const { owner, tripId } = await setup();
    // A party size makes sense for a restaurant, not a flight.
    const res = await book(tripId, owner.accessToken, { details: { partySize: 4 } });
    expect(res.statusCode).toBe(400);
  });

  it('refuses an end before the start', async () => {
    const { owner, tripId } = await setup();
    const res = await book(tripId, owner.accessToken, { startsAt: inDays(3, 11), endsAt: inDays(3, 8) });
    expect(res.statusCode).toBe(400);
  });

  it('lets a viewer read bookings but not add one', async () => {
    const { viewer, tripId } = await setup();
    expect((await book(tripId, viewer.accessToken)).statusCode).toBe(403);
  });

  it("won't link a plan item or a file from another trip", async () => {
    const { owner, tripId } = await setup();
    const otherTrip = await createTrip(ctx.app, owner.accessToken, 'Porto');
    const elsewhere = await addItem(otherTrip, owner.accessToken);

    const res = await book(tripId, owner.accessToken, { itemId: elsewhere.id });
    expect(res.statusCode).toBe(400);
  });

  it('links the confirmation file from the Docs tab', async () => {
    const { owner, tripId } = await setup();
    const started = await ctx.app.inject({
      method: 'POST',
      url: `/trips/${tripId}/documents`,
      headers: bearer(owner.accessToken),
      payload: { name: 'Boarding pass.pdf', contentType: 'application/pdf', sizeBytes: 5000, kind: 'flight' },
    });
    const { document, uploadUrl } = started.json<DocumentUpload>();
    ctx.putObject(uploadUrl, 5000);
    await ctx.app.inject({
      method: 'POST',
      url: `/documents/${document.id}/complete`,
      headers: bearer(owner.accessToken),
    });

    const res = await book(tripId, owner.accessToken, { documentId: document.id });
    expect(res.statusCode).toBe(201);
    expect(res.json<Booking>().documentId).toBe(document.id);
  });

  it('answers 409 with the latest copy when the version is stale', async () => {
    const { owner, editor, tripId } = await setup();
    const booking = (await book(tripId, owner.accessToken)).json<Booking>();

    const first = await ctx.app.inject({
      method: 'PATCH',
      url: `/bookings/${booking.id}`,
      headers: bearer(editor.accessToken),
      payload: { reference: 'NEW123', version: booking.version },
    });
    expect(first.statusCode).toBe(200);

    const stale = await ctx.app.inject({
      method: 'PATCH',
      url: `/bookings/${booking.id}`,
      headers: bearer(owner.accessToken),
      payload: { reference: 'OLD999', version: booking.version },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json<{ current: Booking }>().current.reference).toBe('NEW123');
  });

  it('checks details again when the type changes', async () => {
    const { owner, tripId } = await setup();
    const booking = (await book(tripId, owner.accessToken)).json<Booking>();

    // Turning a flight into a stay while keeping its flight-only fields must fail.
    const res = await ctx.app.inject({
      method: 'PATCH',
      url: `/bookings/${booking.id}`,
      headers: bearer(owner.accessToken),
      payload: { type: 'stay', version: booking.version },
    });
    expect(res.statusCode).toBe(400);
  });

  it('posts an activity card in the main chat', async () => {
    const { owner, tripId } = await setup();
    await book(tripId, owner.accessToken);

    const feed = await ctx.app.inject({
      method: 'GET',
      url: `/trips/${tripId}/messages`,
      headers: bearer(owner.accessToken),
    });
    const card = feed
      .json<{ messages: ChatMessage[] }>()
      .messages.find((m) => m.body.includes('added a flight with TAP Air Portugal'));
    expect(card?.kind).toBe('system');
  });

  it('hides everything from someone who is not on the trip', async () => {
    const { owner, tripId } = await setup();
    const booking = (await book(tripId, owner.accessToken)).json<Booking>();
    const stranger = await ctx.signIn('stranger@example.com');

    const list = await ctx.app.inject({
      method: 'GET',
      url: `/trips/${tripId}/bookings`,
      headers: bearer(stranger.accessToken),
    });
    const edit = await ctx.app.inject({
      method: 'PATCH',
      url: `/bookings/${booking.id}`,
      headers: bearer(stranger.accessToken),
      payload: { reference: 'HACKED', version: booking.version },
    });
    expect(list.statusCode).toBe(404);
    expect(edit.statusCode).toBe(404);
  });
});

describe('next up', () => {
  const nextUp = async (tripId: string, token: string) => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: `/trips/${tripId}/next-up`,
      headers: bearer(token),
    });
    expect(res.statusCode).toBe(200);
    return res.json<NextUp>();
  };

  it('picks the soonest booking that has not started', async () => {
    const { owner, tripId } = await setup();
    const item = await addItem(tripId, owner.accessToken);
    await book(tripId, owner.accessToken, { reference: 'PAST', startsAt: inDays(-2), endsAt: inDays(-2, 11) });
    await book(tripId, owner.accessToken, { reference: 'LATER', startsAt: inDays(9), endsAt: inDays(9, 11) });
    await book(tripId, owner.accessToken, {
      reference: 'SOON',
      itemId: item.id,
      startsAt: inDays(2),
      endsAt: inDays(2, 11),
    });

    const next = await nextUp(tripId, owner.accessToken);
    expect(next.booking?.reference).toBe('SOON');
    expect(next.itemTitle).toBe('Fly to Lisbon');
  });

  it('skips deleted bookings, and says so when nothing is coming', async () => {
    const { owner, tripId } = await setup();
    expect((await nextUp(tripId, owner.accessToken)).booking).toBeNull();

    const booking = (await book(tripId, owner.accessToken)).json<Booking>();
    await ctx.app.inject({
      method: 'DELETE',
      url: `/bookings/${booking.id}`,
      headers: bearer(owner.accessToken),
    });
    expect((await nextUp(tripId, owner.accessToken)).booking).toBeNull();
  });

  it("doesn't link to a plan item that was deleted", async () => {
    const { owner, tripId } = await setup();
    const item = await addItem(tripId, owner.accessToken);
    await book(tripId, owner.accessToken, { itemId: item.id });
    await ctx.app.inject({
      method: 'DELETE',
      url: `/items/${item.id}`,
      headers: bearer(owner.accessToken),
    });

    const next = await nextUp(tripId, owner.accessToken);
    expect(next.booking).not.toBeNull();
    expect(next.booking?.itemId).toBeNull();
    expect(next.itemTitle).toBeNull();
  });
});

describe('item threads', () => {
  const postIn = (itemId: string, token: string, body: string) =>
    ctx.app.inject({
      method: 'POST',
      url: `/items/${itemId}/messages`,
      headers: bearer(token),
      payload: { body },
    });

  it('keeps a thread separate from the main chat, both ways', async () => {
    const { owner, editor, tripId } = await setup();
    const item = await addItem(tripId, owner.accessToken, 'Dinner at Cervejaria Ramiro');

    const threadMsg = await postIn(item.id, editor.accessToken, 'Book for 8pm?');
    expect(threadMsg.statusCode).toBe(201);
    expect(threadMsg.json<ChatMessage>().itemId).toBe(item.id);

    await ctx.app.inject({
      method: 'POST',
      url: `/trips/${tripId}/messages`,
      headers: bearer(owner.accessToken),
      payload: { body: 'Anyone up for a beach day?' },
    });

    const thread = await ctx.app.inject({
      method: 'GET',
      url: `/items/${item.id}/messages`,
      headers: bearer(owner.accessToken),
    });
    const main = await ctx.app.inject({
      method: 'GET',
      url: `/trips/${tripId}/messages`,
      headers: bearer(owner.accessToken),
    });

    const threadBodies = thread.json<{ messages: ChatMessage[] }>().messages.map((m) => m.body);
    const mainBodies = main.json<{ messages: ChatMessage[] }>().messages.map((m) => m.body);
    expect(threadBodies).toEqual(['Book for 8pm?']);
    expect(mainBodies).toContain('Anyone up for a beach day?');
    expect(mainBodies).not.toContain('Book for 8pm?');
  });

  it("doesn't send a push for a thread message", async () => {
    const { owner, editor, tripId } = await setup();
    const item = await addItem(tripId, owner.accessToken);
    ctx.notified.length = 0;

    await postIn(item.id, editor.accessToken, 'Window seat?');
    expect(ctx.notified).toHaveLength(0);
  });

  it('lets a viewer read a thread but not post in it', async () => {
    const { owner, viewer, tripId } = await setup();
    const item = await addItem(tripId, owner.accessToken);

    expect((await postIn(item.id, viewer.accessToken, 'hi')).statusCode).toBe(403);
    const read = await ctx.app.inject({
      method: 'GET',
      url: `/items/${item.id}/messages`,
      headers: bearer(viewer.accessToken),
    });
    expect(read.statusCode).toBe(200);
  });

  it('hides a thread from someone who is not on the trip', async () => {
    const { owner, tripId } = await setup();
    const item = await addItem(tripId, owner.accessToken);
    const stranger = await ctx.signIn('stranger@example.com');

    const read = await ctx.app.inject({
      method: 'GET',
      url: `/items/${item.id}/messages`,
      headers: bearer(stranger.accessToken),
    });
    expect(read.statusCode).toBe(404);
  });

  it('opens the same thread when two people open it at once', async () => {
    const { owner, editor, tripId } = await setup();
    const item = await addItem(tripId, owner.accessToken);

    await Promise.all([
      postIn(item.id, owner.accessToken, 'first'),
      postIn(item.id, editor.accessToken, 'second'),
    ]);
    const thread = await ctx.app.inject({
      method: 'GET',
      url: `/items/${item.id}/messages`,
      headers: bearer(owner.accessToken),
    });
    expect(thread.json<{ messages: ChatMessage[] }>().messages).toHaveLength(2);
  });
});

describe('a single plan item', () => {
  it('can be fetched on its own for its detail screen', async () => {
    const { owner, viewer, tripId } = await setup();
    const item = await addItem(tripId, owner.accessToken);

    const res = await ctx.app.inject({
      method: 'GET',
      url: `/items/${item.id}`,
      headers: bearer(viewer.accessToken),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<ItineraryItem>().title).toBe('Fly to Lisbon');
  });
});
