import type { DayOptimisation, DayRoute, ItineraryItem, TripEvent } from '@tagalong/shared';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, createTrip, joinTrip, useTestApp } from './helpers';

const DAY = '2027-06-12';
// Real spots in Lisbon, west to east along the river.
const BELEM = { latitude: 38.6916, longitude: -9.216 };
const LX_FACTORY = { latitude: 38.7033, longitude: -9.1786 };
const CAIS = { latitude: 38.7057, longitude: -9.1446 };
const ALFAMA = { latitude: 38.7115, longitude: -9.1298 };

describe('a day of the plan', () => {
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
  const add = async (token: string, tripId: string, title: string, extra: object = {}) => {
    const res = await t.app.inject({
      method: 'POST',
      url: `/trips/${tripId}/items`,
      headers: bearer(token),
      payload: { date: DAY, title, ...extra },
    });
    expect(res.statusCode).toBe(201);
    return res.json<ItineraryItem>();
  };
  const get = (token: string, url: string) => t.app.inject({ method: 'GET', url, headers: bearer(token) });
  const order = (token: string, tripId: string, payload: object, date = DAY) =>
    t.app.inject({ method: 'POST', url: `/trips/${tripId}/days/${date}/order`, headers: bearer(token), payload });
  const versionsOf = (items: ItineraryItem[]) => Object.fromEntries(items.map((i) => [i.id, i.version]));
  const titles = async (token: string, tripId: string) =>
    (await get(token, `/trips/${tripId}/items`)).json<{ items: ItineraryItem[] }>().items.filter((i) => i.date === DAY).map((i) => i.title);

  describe('travel between stops', () => {
    it('has a leg between each pair of neighbours with a location', async () => {
      const { owner, tripId } = await setup();
      const a = await add(owner.accessToken, tripId, 'Belém', BELEM);
      const b = await add(owner.accessToken, tripId, 'LX Factory', LX_FACTORY);
      await add(owner.accessToken, tripId, 'Somewhere unknown');
      const d = await add(owner.accessToken, tripId, 'Alfama', ALFAMA);
      const e = await add(owner.accessToken, tripId, 'Cais do Sodré', CAIS);

      const res = await get(owner.accessToken, `/trips/${tripId}/days/${DAY}/route?mode=foot`);
      expect(res.statusCode).toBe(200);
      const route = res.json<DayRoute>();
      // The stop without a location breaks the chain: nothing between LX Factory and Alfama.
      expect(route.legs.map((l) => [l.fromId, l.toId])).toEqual([
        [a.id, b.id],
        [d.id, e.id],
      ]);
      expect(route.estimated).toBe(false);
      expect(route.totalDurationS).toBe(route.legs[0]!.durationS + route.legs[1]!.durationS);
      expect(route.geometry?.coordinates).toHaveLength(4);
      // One call for the whole day.
      expect(t.routing.calls).toEqual(['route:foot:4']);
    });

    it('remembers the answer, so the server is asked once per order', async () => {
      const { owner, tripId } = await setup();
      await add(owner.accessToken, tripId, 'Belém', BELEM);
      await add(owner.accessToken, tripId, 'Alfama', ALFAMA);
      const url = `/trips/${tripId}/days/${DAY}/route?mode=car`;
      const first = (await get(owner.accessToken, url)).json<DayRoute>();
      const second = (await get(owner.accessToken, url)).json<DayRoute>();
      expect(second).toEqual(first);
      expect(t.routing.calls).toEqual(['route:car:2']);
    });

    it('estimates from straight lines when the routing server is down', async () => {
      const { owner, tripId } = await setup();
      await add(owner.accessToken, tripId, 'Belém', BELEM);
      await add(owner.accessToken, tripId, 'Alfama', ALFAMA);
      t.routing.down = true;
      const route = (await get(owner.accessToken, `/trips/${tripId}/days/${DAY}/route?mode=foot`)).json<DayRoute>();
      expect(route.estimated).toBe(true);
      // About 8 km in a straight line, so more than 10 km on foot, at walking pace.
      expect(route.totalDistanceM).toBeGreaterThan(10_000);
      expect(route.totalDurationS / 60).toBeGreaterThan(120);
      // A guess isn't kept: the real answer replaces it once the server is back.
      t.routing.down = false;
      expect((await get(owner.accessToken, `/trips/${tripId}/days/${DAY}/route?mode=foot`)).json<DayRoute>().estimated).toBe(false);
    });

    it('says nothing for a day with fewer than two located stops', async () => {
      const { owner, tripId } = await setup();
      await add(owner.accessToken, tripId, 'Belém', BELEM);
      const route = (await get(owner.accessToken, `/trips/${tripId}/days/${DAY}/route`)).json<DayRoute>();
      expect(route).toMatchObject({ legs: [], totalDurationS: 0, geometry: null, mode: 'foot' });
      expect(t.routing.calls).toEqual([]);
    });

    it('is for people on the trip, viewers included', async () => {
      const { owner, tripId } = await setup();
      const viewer = await joinTrip(t, tripId, owner.accessToken, 'mom@example.com', 'viewer');
      expect((await get(viewer.accessToken, `/trips/${tripId}/days/${DAY}/route`)).statusCode).toBe(200);
      const stranger = await t.signIn('stranger@example.com');
      expect((await get(stranger.accessToken, `/trips/${tripId}/days/${DAY}/route`)).statusCode).toBe(404);
      expect((await get(owner.accessToken, `/trips/${tripId}/days/${DAY}/route?mode=boat`)).statusCode).toBe(400);
    });
  });

  describe('shortest order', () => {
    it('suggests a shorter order, keeping the first and timed stops in place', async () => {
      const { owner, tripId } = await setup();
      const hotel = await add(owner.accessToken, tripId, 'Hotel in Belém', BELEM);
      const alfama = await add(owner.accessToken, tripId, 'Alfama', ALFAMA);
      const lx = await add(owner.accessToken, tripId, 'LX Factory', LX_FACTORY);
      const cais = await add(owner.accessToken, tripId, 'Cais do Sodré', CAIS);
      const dinner = await add(owner.accessToken, tripId, 'Dinner', { ...ALFAMA, startTime: '20:00' });

      const res = await get(owner.accessToken, `/trips/${tripId}/days/${DAY}/optimise?mode=car`);
      expect(res.statusCode).toBe(200);
      const plan = res.json<DayOptimisation>();
      expect(plan.itemIds[0]).toBe(hotel.id);
      expect(plan.itemIds.at(-1)).toBe(dinner.id);
      expect(plan.itemIds).toEqual([hotel.id, lx.id, cais.id, alfama.id, dinner.id]);
      expect(plan.savedS).toBe(plan.beforeS - plan.afterS);
      expect(plan.savedS).toBeGreaterThan(0);
      expect(plan.estimated).toBe(false);
      expect(t.routing.calls).toEqual(['table:car:5']);
    });

    it('is for editors', async () => {
      const { owner, tripId } = await setup();
      const viewer = await joinTrip(t, tripId, owner.accessToken, 'mom@example.com', 'viewer');
      expect((await get(viewer.accessToken, `/trips/${tripId}/days/${DAY}/optimise`)).statusCode).toBe(403);
    });
  });

  describe('saving a new order', () => {
    it('reorders the whole day at once and announces it in one event', async () => {
      const { owner, tripId } = await setup();
      const a = await add(owner.accessToken, tripId, 'A');
      const b = await add(owner.accessToken, tripId, 'B');
      const c = await add(owner.accessToken, tripId, 'C');
      const d = await add(owner.accessToken, tripId, 'D');
      events.length = 0;

      const res = await order(owner.accessToken, tripId, { itemIds: [a.id, c.id, b.id, d.id], versions: versionsOf([a, b, c, d]) });
      expect(res.statusCode).toBe(200);
      expect(res.json<{ items: ItineraryItem[] }>().items.map((i) => i.title)).toEqual(['A', 'C', 'B', 'D']);
      expect(await titles(owner.accessToken, tripId)).toEqual(['A', 'C', 'B', 'D']);

      // A and D kept their places, so they keep their keys and versions.
      const after = res.json<{ items: ItineraryItem[] }>().items;
      expect([after[0]!.version, after[3]!.version]).toEqual([1, 1]);
      const changed = after.filter((i) => i.version === 2).map((i) => i.title);
      expect(changed).toContain('C');

      await new Promise((r) => setTimeout(r, 100));
      const reordered = events.filter((e) => e.type === 'day.reordered');
      expect(reordered).toHaveLength(1);
      expect(reordered[0]).toMatchObject({ tripId, payload: { date: DAY } });
      expect((reordered[0]!.payload as { items: ItineraryItem[] }).items.map((i) => i.title).sort()).toEqual(changed.sort());
      expect(events.filter((e) => e.type === 'item.upserted')).toHaveLength(0);
    });

    it('refuses a stale order with the day as it is now', async () => {
      const { owner, tripId } = await setup();
      const sam = await joinTrip(t, tripId, owner.accessToken, 'sam@example.com');
      const a = await add(owner.accessToken, tripId, 'A');
      const b = await add(owner.accessToken, tripId, 'B');
      // Sam renames B in the meantime.
      await t.app.inject({ method: 'PATCH', url: `/items/${b.id}`, headers: bearer(sam.accessToken), payload: { version: 1, title: 'B2' } });

      const res = await order(owner.accessToken, tripId, { itemIds: [b.id, a.id], versions: versionsOf([a, b]) });
      expect(res.statusCode).toBe(409);
      expect(res.json<{ current: ItineraryItem[] }>().current.map((i) => i.title)).toEqual(['A', 'B2']);
      expect(await titles(owner.accessToken, tripId)).toEqual(['A', 'B2']);
    });

    it('refuses an order that misses an item added meanwhile', async () => {
      const { owner, tripId } = await setup();
      const a = await add(owner.accessToken, tripId, 'A');
      const b = await add(owner.accessToken, tripId, 'B');
      await add(owner.accessToken, tripId, 'New');
      const res = await order(owner.accessToken, tripId, { itemIds: [b.id, a.id], versions: versionsOf([a, b]) });
      expect(res.statusCode).toBe(409);
    });

    it('refuses items from another day or another trip', async () => {
      const { owner, tripId } = await setup();
      const a = await add(owner.accessToken, tripId, 'A');
      const other = await add(owner.accessToken, tripId, 'Next day', { date: '2027-06-13' });
      const otherTrip = await createTrip(t.app, owner.accessToken, 'Porto');
      const elsewhere = await add(owner.accessToken, otherTrip, 'In Porto');

      expect((await order(owner.accessToken, tripId, { itemIds: [other.id, a.id], versions: versionsOf([a, other]) })).statusCode).toBe(400);
      expect((await order(owner.accessToken, tripId, { itemIds: [elsewhere.id, a.id], versions: versionsOf([a, elsewhere]) })).statusCode).toBe(400);
      expect((await order(owner.accessToken, tripId, { itemIds: [a.id, a.id], versions: versionsOf([a]) })).statusCode).toBe(400);
    });

    it('is for editors', async () => {
      const { owner, tripId } = await setup();
      const viewer = await joinTrip(t, tripId, owner.accessToken, 'mom@example.com', 'viewer');
      const a = await add(owner.accessToken, tripId, 'A');
      const b = await add(owner.accessToken, tripId, 'B');
      const res = await order(viewer.accessToken, tripId, { itemIds: [b.id, a.id], versions: versionsOf([a, b]) });
      expect(res.statusCode).toBe(403);
    });
  });
});
