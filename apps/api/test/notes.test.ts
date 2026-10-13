import { ItemList, type TripDay, type TripEvent, type TripNote } from '@tagalong/shared';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, createTrip, joinTrip, useTestApp } from './helpers';

const DAY = '2027-06-12';

describe('notes', () => {
  const t = useTestApp();

  let listener: Redis;
  const events: TripEvent[] = [];
  beforeAll(async () => {
    listener = new Redis(process.env.REDIS_URL!);
    await listener.psubscribe('trip:*');
    listener.on('pmessage', (_p, _c, raw) => events.push(JSON.parse(raw)));
  });
  afterAll(() => listener.disconnect());
  const quiet = async () => {
    await new Promise((r) => setTimeout(r, 100));
    events.length = 0;
  };
  const heard = async (type: TripEvent['type']) => {
    await new Promise((r) => setTimeout(r, 100));
    return events.filter((e) => e.type === type);
  };

  const setup = async () => {
    const owner = await t.signIn('owner@example.com');
    const tripId = await createTrip(t.app, owner.accessToken);
    const sam = await joinTrip(t, tripId, owner.accessToken, 'sam@example.com', 'editor');
    const viewer = await joinTrip(t, tripId, owner.accessToken, 'viewer@example.com', 'viewer');
    return { owner, sam, viewer, tripId };
  };
  const call = (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, token: string, payload?: object) =>
    t.app.inject({ method, url, headers: bearer(token), payload });

  describe('day notes', () => {
    it('makes the day on the first write, then needs the version', async () => {
      const { owner, sam, viewer, tripId } = await setup();
      await quiet();
      const first = await call('PUT', `/trips/${tripId}/days/${DAY}`, owner.accessToken, {
        title: 'Sintra day',
        notes: '9:10 train from Rossio',
      });
      expect(first.statusCode).toBe(200);
      expect(first.json<TripDay>()).toMatchObject({ date: DAY, title: 'Sintra day', version: 1 });

      // Someone else also thinks they're first: 409 with what's there now.
      const race = await call('PUT', `/trips/${tripId}/days/${DAY}`, sam.accessToken, { title: 'Beach day' });
      expect(race.statusCode).toBe(409);
      expect(race.json().current).toMatchObject({ title: 'Sintra day', version: 1 });

      const edit = await call('PUT', `/trips/${tripId}/days/${DAY}`, sam.accessToken, { version: 1, notes: '9:40 train' });
      expect(edit.json<TripDay>()).toMatchObject({ title: 'Sintra day', notes: '9:40 train', version: 2 });
      const stale = await call('PUT', `/trips/${tripId}/days/${DAY}`, owner.accessToken, { version: 1, notes: 'Taxi' });
      expect(stale.statusCode).toBe(409);
      expect(stale.json().current.notes).toBe('9:40 train');

      // An empty title clears it.
      const cleared = await call('PUT', `/trips/${tripId}/days/${DAY}`, owner.accessToken, { version: 2, title: '  ' });
      expect(cleared.json<TripDay>().title).toBeNull();

      const plan = ItemList.parse((await call('GET', `/trips/${tripId}/items`, viewer.accessToken)).json());
      expect(plan.days).toEqual([expect.objectContaining({ date: DAY, title: null, notes: '9:40 train', version: 3 })]);

      const published = await heard('day.upserted');
      expect(published).toHaveLength(3);
      expect(published[0]).toMatchObject({ tripId, payload: { date: DAY, title: 'Sintra day' } });
    });

    it('lets only editors write a day note', async () => {
      const { viewer, tripId } = await setup();
      const res = await call('PUT', `/trips/${tripId}/days/${DAY}`, viewer.accessToken, { title: 'Mine' });
      expect(res.statusCode).toBe(403);
      const bad = await call('PUT', `/trips/${tripId}/days/june-12`, viewer.accessToken, { title: 'Mine' });
      expect(bad.statusCode).toBe(400);
    });
  });

  describe('trip notes', () => {
    it('adds, lists (pinned first), edits and deletes notes', async () => {
      const { owner, sam, viewer, tripId } = await setup();
      await quiet();
      const wifi = await call('POST', `/trips/${tripId}/notes`, owner.accessToken, { title: 'Wi-Fi codes', body: 'Flat: lisboa2027' });
      expect(wifi.statusCode).toBe(201);
      const sos = await call('POST', `/trips/${tripId}/notes`, sam.accessToken, { title: 'Emergency numbers', body: '112', pinned: true });

      const list = await call('GET', `/trips/${tripId}/notes`, viewer.accessToken);
      expect(list.json<{ notes: TripNote[] }>().notes.map((n) => n.title)).toEqual(['Emergency numbers', 'Wi-Fi codes']);

      const edited = await call('PATCH', `/notes/${wifi.json<TripNote>().id}`, sam.accessToken, { version: 1, body: 'Flat: lisboa2028' });
      expect(edited.json<TripNote>()).toMatchObject({ body: 'Flat: lisboa2028', version: 2 });

      expect((await call('DELETE', `/notes/${sos.json<TripNote>().id}`, owner.accessToken)).statusCode).toBe(204);
      const after = await call('GET', `/trips/${tripId}/notes`, owner.accessToken);
      expect(after.json<{ notes: TripNote[] }>().notes.map((n) => n.title)).toEqual(['Wi-Fi codes']);

      expect(await heard('note.upserted')).toHaveLength(3);
      expect((await heard('note.deleted')).map((e) => e.entityId)).toEqual([sos.json<TripNote>().id]);
    });

    it('answers a stale save with their copy, saying who changed it', async () => {
      const { owner, sam, tripId } = await setup();
      const note = (await call('POST', `/trips/${tripId}/notes`, owner.accessToken, { title: 'Phrases', body: 'Obrigado' })).json<TripNote>();
      const samsSave = await call('PATCH', `/notes/${note.id}`, sam.accessToken, { version: 1, body: 'Obrigado / Obrigada' });
      const samId = samsSave.json<TripNote>().updatedBy;

      const mine = await call('PATCH', `/notes/${note.id}`, owner.accessToken, { version: 1, body: 'Obrigado, bom dia' });
      expect(mine.statusCode).toBe(409);
      expect(mine.json().current).toMatchObject({ body: 'Obrigado / Obrigada', version: 2, updatedBy: samId });

      // "Keep mine": save again on top of their version.
      const kept = await call('PATCH', `/notes/${note.id}`, owner.accessToken, { version: 2, body: 'Obrigado, bom dia' });
      expect(kept.json<TripNote>()).toMatchObject({ body: 'Obrigado, bom dia', version: 3 });
    });

    it('returns the same note when a create is retried, and stops viewers writing', async () => {
      const { owner, viewer, tripId } = await setup();
      const payload = { id: crypto.randomUUID(), title: 'Wi-Fi', body: '' };
      const a = await call('POST', `/trips/${tripId}/notes`, owner.accessToken, payload);
      const b = await call('POST', `/trips/${tripId}/notes`, owner.accessToken, payload);
      expect([a.statusCode, b.statusCode]).toEqual([201, 200]);

      expect((await call('POST', `/trips/${tripId}/notes`, viewer.accessToken, { title: 'Mine' })).statusCode).toBe(403);
      expect((await call('PATCH', `/notes/${payload.id}`, viewer.accessToken, { version: 1, body: 'x' })).statusCode).toBe(403);
      expect((await call('DELETE', `/notes/${payload.id}`, viewer.accessToken)).statusCode).toBe(403);
    });

    it('refuses a note over 20,000 characters', async () => {
      const { owner, tripId } = await setup();
      const res = await call('POST', `/trips/${tripId}/notes`, owner.accessToken, { title: 'Long', body: 'x'.repeat(20_001) });
      expect(res.statusCode).toBe(400);
    });
  });
});
