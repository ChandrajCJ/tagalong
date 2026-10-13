import type { Booking, BookingImport, ItineraryItem, TripEvent } from '@tagalong/shared';
import { readFileSync } from 'node:fs';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createImportsService, inboxAddress } from '../src/modules/imports/service';
import { bearer, createTrip, joinTrip, useTestApp } from './helpers';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/booking-emails/${name}`, import.meta.url));

describe('bookings from email: imports', () => {
  const t = useTestApp();

  let listener: Redis;
  const events: TripEvent[] = [];
  beforeAll(async () => {
    listener = new Redis(process.env.REDIS_URL!);
    await listener.psubscribe('trip:*');
    listener.on('pmessage', (_p, _c, raw) => events.push(JSON.parse(raw)));
  });
  afterAll(() => listener.disconnect());

  const setup = async () => {
    const owner = await t.signIn('owner@example.com');
    const tripId = await createTrip(t.app, owner.accessToken);
    return { owner, tripId };
  };
  const paste = (token: string, tripId: string, text: string, id?: string) =>
    t.app.inject({ method: 'POST', url: `/trips/${tripId}/imports`, headers: bearer(token), payload: { text, id } });

  /** Puts a file in Docs the way the app does: start, upload, complete. */
  const uploadDoc = async (token: string, tripId: string, name: string, contentType: string, body: Buffer) => {
    const start = await t.app.inject({
      method: 'POST',
      url: `/trips/${tripId}/documents`,
      headers: bearer(token),
      payload: { name, contentType, sizeBytes: body.length },
    });
    const { document, uploadUrl } = start.json<{ document: { id: string }; uploadUrl: string }>();
    t.putObject(uploadUrl, body.length, body);
    const done = await t.app.inject({ method: 'POST', url: `/documents/${document.id}/complete`, headers: bearer(token) });
    expect(done.statusCode).toBe(200);
    return document.id;
  };

  it('reads a pasted email into bookings to review, and lists it', async () => {
    const { owner, tripId } = await setup();
    events.length = 0;
    const res = await paste(owner.accessToken, tripId, fixture('indigo-return.txt').toString());
    expect(res.statusCode).toBe(201);
    const found = res.json<BookingImport>();
    expect(found).toMatchObject({ source: 'paste', status: 'pending', createdBy: expect.any(String) });
    expect(found.candidates.map((c) => [c.booking.details.flightNumber, c.state])).toEqual([
      ['6E 2134', 'open'],
      ['6E 5098', 'open'],
    ]);

    const list = await t.app.inject({ method: 'GET', url: `/trips/${tripId}/imports`, headers: bearer(owner.accessToken) });
    expect(list.json<{ imports: BookingImport[] }>().imports.map((i) => i.id)).toEqual([found.id]);
    await new Promise((r) => setTimeout(r, 100));
    expect(events.filter((e) => e.type === 'import.created' && e.entityId === found.id)).toHaveLength(1);
    // A paste doesn't announce itself in chat; it was you who pasted it.
    expect(events.filter((e) => e.type === 'message.created')).toHaveLength(0);
  });

  it('gives back the same import when a paste is retried', async () => {
    const { owner, tripId } = await setup();
    const id = '01920000-0000-7000-8000-000000000001';
    expect((await paste(owner.accessToken, tripId, fixture('restaurant.txt').toString(), id)).statusCode).toBe(201);
    expect((await paste(owner.accessToken, tripId, fixture('restaurant.txt').toString(), id)).statusCode).toBe(200);
  });

  it('says so when nothing was found, without leaving anything to review', async () => {
    const { owner, tripId } = await setup();
    const found = (await paste(owner.accessToken, tripId, fixture('newsletter.txt').toString())).json<BookingImport>();
    expect(found).toMatchObject({ status: 'dismissed', candidates: [] });
  });

  it('reads a ticket PDF already in Docs, and refuses pictures', async () => {
    const { owner, tripId } = await setup();
    const pdf = await uploadDoc(owner.accessToken, tripId, 'Air India ticket.pdf', 'application/pdf', fixture('air-india-ticket.pdf'));
    const res = await t.app.inject({ method: 'POST', url: `/trips/${tripId}/imports`, headers: bearer(owner.accessToken), payload: { documentId: pdf } });
    expect(res.statusCode).toBe(201);
    expect(res.json<BookingImport>()).toMatchObject({
      source: 'document',
      documentId: pdf,
      subject: 'Air India ticket.pdf',
      candidates: [{ booking: { reference: 'R4TN8Q', details: { flightNumber: 'AI 865' } } }],
    });

    const png = await uploadDoc(owner.accessToken, tripId, 'screenshot.png', 'image/png', Buffer.from('not really a png'));
    const refused = await t.app.inject({ method: 'POST', url: `/trips/${tripId}/imports`, headers: bearer(owner.accessToken), payload: { documentId: png } });
    expect(refused.statusCode).toBe(400);
    expect(refused.json()).toMatchObject({ error: 'unreadable' });
  });

  it('adds a candidate with the person’s edits, in the plan too, and only once', async () => {
    const { owner, tripId } = await setup();
    const found = (await paste(owner.accessToken, tripId, fixture('indigo-return.txt').toString())).json<BookingImport>();
    const first = found.candidates[0]!.booking;
    const add = (index: number, booking: object) =>
      t.app.inject({
        method: 'POST',
        url: `/imports/${found.id}/add`,
        headers: bearer(owner.accessToken),
        payload: { candidateIndex: index, booking },
      });

    const res = await add(0, { ...first, details: { ...first.details, seats: '14A' } });
    expect(res.statusCode).toBe(200);
    const { bookingId, itemId, import: after } = res.json<{ bookingId: string; itemId: string; import: BookingImport }>();
    expect(after.status).toBe('pending');
    expect(after.candidates.map((c) => c.state)).toEqual(['added', 'open']);

    const bookings = (await t.app.inject({ method: 'GET', url: `/trips/${tripId}/bookings`, headers: bearer(owner.accessToken) })).json<{ bookings: Booking[] }>().bookings;
    expect(bookings).toEqual([
      expect.objectContaining({ id: bookingId, itemId, reference: 'K7XQ2M', details: expect.objectContaining({ seats: '14A' }) }),
    ]);
    const items = (await t.app.inject({ method: 'GET', url: `/trips/${tripId}/items`, headers: bearer(owner.accessToken) })).json<{ items: ItineraryItem[] }>().items;
    expect(items).toEqual([expect.objectContaining({ id: itemId, title: 'Flight BOM → GOI', type: 'flight', date: '2026-06-12', startTime: '08:15' })]);

    // A second tap (or a second person) doesn't make a copy.
    const again = await add(0, first);
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ current: { id: found.id } });

    // "Not this" for the other one finishes the import.
    const skipped = await t.app.inject({ method: 'POST', url: `/imports/${found.id}/dismiss`, headers: bearer(owner.accessToken), payload: { candidateIndex: 1 } });
    expect(skipped.json<BookingImport>()).toMatchObject({ status: 'added', candidates: [{ state: 'added' }, { state: 'skipped' }] });
  });

  it('adds without a plan item when asked, and dismisses everything at once', async () => {
    const { owner, tripId } = await setup();
    const found = (await paste(owner.accessToken, tripId, fixture('indigo-return.txt').toString())).json<BookingImport>();
    const res = await t.app.inject({
      method: 'POST',
      url: `/imports/${found.id}/add`,
      headers: bearer(owner.accessToken),
      payload: { candidateIndex: 1, booking: found.candidates[1]!.booking, addToPlan: false },
    });
    expect(res.json()).toMatchObject({ itemId: null });

    const other = (await paste(owner.accessToken, tripId, fixture('restaurant.txt').toString())).json<BookingImport>();
    const all = await t.app.inject({ method: 'POST', url: `/imports/${other.id}/dismiss`, headers: bearer(owner.accessToken) });
    expect(all.json<BookingImport>()).toMatchObject({ status: 'dismissed', candidates: [{ state: 'skipped' }] });
  });

  it('gives a candidate back if the booking can’t be saved', async () => {
    const { owner, tripId } = await setup();
    const found = (await paste(owner.accessToken, tripId, fixture('restaurant.txt').toString())).json<BookingImport>();
    const bad = await t.app.inject({
      method: 'POST',
      url: `/imports/${found.id}/add`,
      headers: bearer(owner.accessToken),
      // A plan item from nowhere: the booking is refused.
      payload: { candidateIndex: 0, booking: { ...found.candidates[0]!.booking, itemId: '01920000-0000-7000-8000-00000000abcd' } },
    });
    expect(bad.statusCode).toBe(400);
    const list = (await t.app.inject({ method: 'GET', url: `/trips/${tripId}/imports`, headers: bearer(owner.accessToken) })).json<{ imports: BookingImport[] }>();
    expect(list.imports[0]!.candidates[0]!.state).toBe('open');
  });

  it('is for editors: viewers can’t see or add imports', async () => {
    const { owner, tripId } = await setup();
    const viewer = await joinTrip(t, tripId, owner.accessToken, 'mom@example.com', 'viewer');
    const found = (await paste(owner.accessToken, tripId, fixture('restaurant.txt').toString())).json<BookingImport>();
    expect((await paste(viewer.accessToken, tripId, 'Booking reference: ABC123')).statusCode).toBe(403);
    expect((await t.app.inject({ method: 'GET', url: `/trips/${tripId}/imports`, headers: bearer(viewer.accessToken) })).statusCode).toBe(403);
    const add = await t.app.inject({
      method: 'POST',
      url: `/imports/${found.id}/add`,
      headers: bearer(viewer.accessToken),
      payload: { candidateIndex: 0, booking: found.candidates[0]!.booking },
    });
    expect(add.statusCode).toBe(403);
    expect((await t.app.inject({ method: 'POST', url: `/imports/${found.id}/dismiss`, headers: bearer(viewer.accessToken) })).statusCode).toBe(403);
  });

  describe('the trip’s forwarding address', () => {
    it('is hidden when the server has no inbox', async () => {
      const { owner, tripId } = await setup();
      const res = await t.app.inject({ method: 'GET', url: `/trips/${tripId}/inbox`, headers: bearer(owner.accessToken) });
      expect(res.json()).toEqual({ address: null });
    });

    it('is made once, stays the same, and only the owner can change it', async () => {
      const { owner, tripId } = await setup();
      const editor = await joinTrip(t, tripId, owner.accessToken, 'sam@example.com');
      const service = createImportsService(t.db, t.redis, t.storage, 'tagalong.inbox@gmail.com');
      const me = await t.app.inject({ method: 'GET', url: '/me', headers: bearer(owner.accessToken) });
      const ownerId = me.json<{ id: string }>().id;
      const first = await service.inbox(tripId, ownerId);
      expect(first.address).toMatch(/^tagalong\.inbox\+[a-z0-9]{10}@gmail\.com$/);
      expect((await service.inbox(tripId, editor.userId)).address).toBe(first.address);
      await expect(service.rotateInbox(tripId, editor.userId)).rejects.toMatchObject({ statusCode: 403 });
      const rotated = await service.rotateInbox(tripId, ownerId);
      expect(rotated.address).not.toBe(first.address);
      expect(inboxAddress('tagalong.inbox+old@gmail.com', 'abc')).toBe('tagalong.inbox+abc@gmail.com');
    });
  });
});
