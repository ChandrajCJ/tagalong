import { tripChannel, type LiveLocation, type TripEvent } from '@tagalong/shared';
import { sql } from 'drizzle-orm';
import { Redis } from 'ioredis';
import { describe, expect, it } from 'vitest';
import { locationKey } from '../src/modules/location/service';
import { bearer, createTrip, joinTrip, useTestApp } from './helpers';

const ctx = useTestApp();

const inHours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();
const share = (token: string, tripId: string, until = inHours(1), at = { latitude: 15.49, longitude: 73.77 }) =>
  ctx.app.inject({ method: 'POST', url: `/trips/${tripId}/location`, headers: bearer(token), payload: { ...at, accuracy: 25, until } });
const list = async (token: string, tripId: string) =>
  ctx.app.inject({ method: 'GET', url: `/trips/${tripId}/locations`, headers: bearer(token) });

const setup = async () => {
  const owner = await ctx.signIn('owner@example.com');
  const tripId = await createTrip(ctx.app, owner.accessToken, 'Goa');
  const priya = await joinTrip(ctx, tripId, owner.accessToken, 'priya@example.com', 'viewer');
  return { owner, tripId, priya };
};

/** Listens on trips' channels, as the gateway does. */
const listen = async (tripIds: string[]) => {
  const sub = new Redis(process.env.REDIS_URL!);
  const heard: TripEvent[] = [];
  sub.on('message', (_channel, message) => heard.push(JSON.parse(message) as TripEvent));
  await sub.subscribe(...tripIds.map(tripChannel));
  return { heard, close: () => sub.quit() };
};

const settle = () => new Promise((r) => setTimeout(r, 100));

describe('live location', () => {
  it('shares a position with the trip until its time runs out', async () => {
    const { owner, tripId, priya } = await setup();
    const res = await share(priya.accessToken, tripId);
    expect(res.statusCode).toBe(200);
    const seen = (await list(owner.accessToken, tripId)).json<{ locations: LiveLocation[] }>().locations;
    expect(seen).toEqual([
      expect.objectContaining({ userId: priya.userId, displayName: 'priya', latitude: 15.49, longitude: 73.77, accuracy: 25 }),
    ]);
    const ttl = await ctx.redis.pttl(locationKey(tripId, priya.userId));
    expect(ttl).toBeGreaterThan(3_500_000);
    expect(ttl).toBeLessThanOrEqual(3_600_000);
  });

  it('forgets positions when their time is up', async () => {
    const { owner, tripId, priya } = await setup();
    expect((await share(priya.accessToken, tripId, new Date(Date.now() + 1_200).toISOString())).statusCode).toBe(200);
    await new Promise((r) => setTimeout(r, 1_400));
    expect((await list(owner.accessToken, tripId)).json().locations).toEqual([]);
    // A time already past isn't accepted, nor more than a day.
    expect((await share(priya.accessToken, tripId, inHours(-1))).statusCode).toBe(400);
    expect((await share(priya.accessToken, tripId, inHours(30))).statusCode).toBe(400);
  });

  it('is for people on the trip only, and never reaches the database', async () => {
    const { owner, tripId, priya } = await setup();
    const stranger = await ctx.signIn('stranger@example.com');
    expect((await share(stranger.accessToken, tripId)).statusCode).toBe(404);
    expect((await list(stranger.accessToken, tripId)).statusCode).toBe(404);
    await share(priya.accessToken, tripId, inHours(1), { latitude: 15.123456, longitude: 73.654321 });
    // Nothing about it is logged as a change, and the coordinates are in no table.
    const count = async (query: ReturnType<typeof sql>) => (await ctx.db.execute(query)) as unknown as { n: number }[];
    expect(await count(sql`select count(*)::int as n from sync.change_log where entity like 'location%'`)).toEqual([{ n: 0 }]);
    const found = await count(sql`
      select count(*)::int as n from trips.trip_places where latitude = 15.123456
      union all select count(*)::int from itinerary.items where latitude = 15.123456
      union all select count(*)::int from itinerary.ideas where latitude = 15.123456`);
    expect(found.every((r) => r.n === 0)).toBe(true);
    expect((await list(owner.accessToken, tripId)).json().locations).toHaveLength(1);
  });

  it('takes one position per 20 seconds from each person', async () => {
    const { tripId, priya } = await setup();
    expect((await share(priya.accessToken, tripId)).statusCode).toBe(200);
    expect((await share(priya.accessToken, tripId)).statusCode).toBe(429);
  });

  it('stops when asked, and when they leave the trip', async () => {
    const { owner, tripId, priya } = await setup();
    await share(priya.accessToken, tripId);
    const stop = await ctx.app.inject({ method: 'DELETE', url: `/trips/${tripId}/location`, headers: bearer(priya.accessToken) });
    expect(stop.statusCode).toBe(204);
    expect((await list(owner.accessToken, tripId)).json().locations).toEqual([]);

    // Sharing again straight after stopping is fine; leaving ends it.
    expect((await share(priya.accessToken, tripId)).statusCode).toBe(200);
    await ctx.app.inject({ method: 'DELETE', url: `/trips/${tripId}/members/${priya.userId}`, headers: bearer(priya.accessToken) });
    expect(await ctx.redis.exists(locationKey(tripId, priya.userId))).toBe(0);
    expect((await list(owner.accessToken, tripId)).json().locations).toEqual([]);
  });

  it('tells only that trip’s viewers', async () => {
    const { owner, tripId, priya } = await setup();
    const otherTrip = await createTrip(ctx.app, owner.accessToken, 'Lisbon');
    const { heard, close } = await listen([tripId, otherTrip]);
    await share(priya.accessToken, tripId);
    await ctx.app.inject({ method: 'DELETE', url: `/trips/${tripId}/location`, headers: bearer(priya.accessToken) });
    await settle();
    await close();
    const located = heard.filter((e) => e.type.startsWith('location.'));
    expect(located.map((e) => [e.type, e.tripId])).toEqual([
      ['location.updated', tripId],
      ['location.stopped', tripId],
    ]);
    expect(located[0]!.payload).toMatchObject({ userId: priya.userId, latitude: 15.49 });
  });
});
