import { newId, positionBetween, type TripEvent } from '@tagalong/shared';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, createTrip, joinTrip, useTestApp } from './helpers';

describe('itinerary items', () => {
  const t = useTestApp();

  // Listen to trip events the way the gateway does.
  let listener: Redis;
  const events: TripEvent[] = [];
  beforeAll(async () => {
    listener = new Redis(process.env.REDIS_URL!);
    await listener.psubscribe('trip:*');
    listener.on('pmessage', (_p, _c, raw) => events.push(JSON.parse(raw)));
  });
  afterAll(() => listener.disconnect());

  const waitForEvent = async (match: (e: TripEvent) => boolean) => {
    for (let i = 0; i < 50; i++) {
      const found = events.find(match);
      if (found) return found;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error('Expected event was not published');
  };

  const setup = async () => {
    const owner = await t.signIn('owner@example.com');
    const tripId = await createTrip(t.app, owner.accessToken);
    return { owner, tripId };
  };
  const addItem = (token: string, tripId: string, payload: object) =>
    t.app.inject({ method: 'POST', url: `/trips/${tripId}/items`, headers: bearer(token), payload });
  const patch = (token: string, itemId: string, payload: object) =>
    t.app.inject({ method: 'PATCH', url: `/items/${itemId}`, headers: bearer(token), payload });
  const list = async (token: string, tripId: string) =>
    (await t.app.inject({ method: 'GET', url: `/trips/${tripId}/items`, headers: bearer(token) })).json()
      .items as { id: string; title: string; position: string }[];

  it('adds items to the end of a day and lists them in order', async () => {
    const { owner, tripId } = await setup();
    const day = { date: '2027-06-12' };
    const a = await addItem(owner.accessToken, tripId, { ...day, title: 'Flight', type: 'flight', startTime: '08:15' });
    expect(a.statusCode).toBe(201);
    expect(a.json()).toMatchObject({ title: 'Flight', type: 'flight', startTime: '08:15', version: 1 });
    await addItem(owner.accessToken, tripId, { ...day, title: 'Lunch', type: 'meal' });
    await addItem(owner.accessToken, tripId, { title: 'Pastéis de Belém' }); // no date: "Anytime"

    const items = await list(owner.accessToken, tripId);
    expect(items.map((i) => i.title)).toEqual(['Pastéis de Belém', 'Flight', 'Lunch']);
  });

  it('moves an item by changing only its position', async () => {
    const { owner, tripId } = await setup();
    const day = { date: '2027-06-12' };
    await addItem(owner.accessToken, tripId, { ...day, title: 'A' });
    await addItem(owner.accessToken, tripId, { ...day, title: 'B' });
    const c = (await addItem(owner.accessToken, tripId, { ...day, title: 'C' })).json();

    const [first] = await list(owner.accessToken, tripId);
    const moved = await patch(owner.accessToken, c.id, {
      version: c.version,
      position: positionBetween(null, first!.position),
    });
    expect(moved.statusCode).toBe(200);
    expect((await list(owner.accessToken, tripId)).map((i) => i.title)).toEqual(['C', 'A', 'B']);
  });

  it('rejects a stale edit with the latest copy', async () => {
    const { owner, tripId } = await setup();
    const sam = await joinTrip(t, tripId, owner.accessToken, 'sam@example.com');
    const item = (await addItem(owner.accessToken, tripId, { title: 'Dinner' })).json();

    // Sam saves first...
    const samEdit = await patch(sam.accessToken, item.id, { version: 1, title: 'Dinner at Taberna' });
    expect(samEdit.json()).toMatchObject({ version: 2 });

    // ...then the owner saves based on the old version.
    const stale = await patch(owner.accessToken, item.id, { version: 1, title: 'Dinner somewhere' });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({
      error: 'conflict',
      current: { title: 'Dinner at Taberna', version: 2 },
    });
  });

  it('lets viewers read but not change the plan', async () => {
    const { owner, tripId } = await setup();
    const viewer = await joinTrip(t, tripId, owner.accessToken, 'mom@example.com', 'viewer');
    const item = (await addItem(owner.accessToken, tripId, { title: 'Museum' })).json();

    expect(await list(viewer.accessToken, tripId)).toHaveLength(1);
    expect((await addItem(viewer.accessToken, tripId, { title: 'Nope' })).statusCode).toBe(403);
    expect((await patch(viewer.accessToken, item.id, { version: 1, title: 'Nope' })).statusCode).toBe(403);
  });

  it('hides the plan from strangers', async () => {
    const { owner, tripId } = await setup();
    const item = (await addItem(owner.accessToken, tripId, { title: 'Secret' })).json();
    const stranger = await t.signIn('stranger@example.com');
    const res = await t.app.inject({ method: 'GET', url: `/trips/${tripId}/items`, headers: bearer(stranger.accessToken) });
    expect(res.statusCode).toBe(404);
    expect((await patch(stranger.accessToken, item.id, { version: 1, title: 'x' })).statusCode).toBe(404);
  });

  it('soft-deletes, so the item disappears from the list', async () => {
    const { owner, tripId } = await setup();
    const item = (await addItem(owner.accessToken, tripId, { title: 'Gone soon' })).json();
    const del = await t.app.inject({ method: 'DELETE', url: `/items/${item.id}`, headers: bearer(owner.accessToken) });
    expect(del.statusCode).toBe(204);
    expect(await list(owner.accessToken, tripId)).toHaveLength(0);
    expect((await patch(owner.accessToken, item.id, { version: 2, title: 'x' })).statusCode).toBe(404);
  });

  it('treats a retried create with the same id as one item', async () => {
    const { owner, tripId } = await setup();
    const payload = { id: newId(), title: 'Boat tour' };
    expect((await addItem(owner.accessToken, tripId, payload)).statusCode).toBe(201);
    expect((await addItem(owner.accessToken, tripId, payload)).statusCode).toBe(200);
    expect(await list(owner.accessToken, tripId)).toHaveLength(1);
  });

  it('announces changes after saving', async () => {
    const { owner, tripId } = await setup();
    const item = (await addItem(owner.accessToken, tripId, { title: 'Fado night' })).json();
    const created = await waitForEvent((e) => e.type === 'item.upserted' && e.entityId === item.id);
    expect(created).toMatchObject({ tripId, version: 1, payload: { title: 'Fado night' } });

    await t.app.inject({ method: 'DELETE', url: `/items/${item.id}`, headers: bearer(owner.accessToken) });
    await waitForEvent((e) => e.type === 'item.deleted' && e.entityId === item.id);
  });
});
