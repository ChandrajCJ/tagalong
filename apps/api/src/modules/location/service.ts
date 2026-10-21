import { and, eq, isNull } from 'drizzle-orm';
import { tripMembers, users, type Db } from '@tagalong/db';
import {
  LIVE_LOCATION_MAX_MS,
  LiveLocation,
  LOCATION_RATE_SECONDS,
  type ShareLocationInput,
} from '@tagalong/shared';
import type { Redis } from 'ioredis';
import type { z } from 'zod';
import { requireTripRole } from '../../lib/access';
import { badRequest, tooMany } from '../../lib/errors';
import { publishTripEvent } from '../../lib/events';

type Share = z.output<typeof ShareLocationInput>;

/** Where a person's position on a trip lives, until its time runs out. */
export const locationKey = (tripId: string, userId: string) => `location:${tripId}:${userId}`;
const rateKey = (userId: string) => `location-rate:${userId}`;

/**
 * Stops someone sharing on a trip: the position goes and everyone viewing
 * hears. Used when they stop, and when they leave or are removed.
 */
export const stopSharing = async (redis: Redis, tripId: string, userId: string, actorId = userId, origin?: string) => {
  const removed = await redis.del(locationKey(tripId, userId), rateKey(userId)).catch(() => 0);
  if (removed > 0) {
    await publishTripEvent(redis, {
      type: 'location.stopped',
      tripId,
      entityId: userId,
      actorId,
      payload: { userId },
      originClientId: origin,
    });
  }
};

/**
 * Live location, ephemeral by design: positions are kept in Redis only, each
 * expiring when its sharing time runs out, and are never written to the
 * database. Only people on the trip can send or see them.
 */
export const createLocationService = (db: Db, redis: Redis) => ({
  async share(tripId: string, userId: string, input: Share, origin?: string, now = new Date()): Promise<LiveLocation> {
    await requireTripRole(db, tripId, userId, 'viewer');
    const left = Date.parse(input.until) - now.getTime();
    if (left <= 0) throw badRequest('That sharing time has already passed', 'expired');
    if (left > LIVE_LOCATION_MAX_MS + 60_000) throw badRequest('Share your location for a day at most');
    // One position per 20 s: a phone that sends faster is told to slow down.
    const first = await redis.set(rateKey(userId), '1', 'EX', LOCATION_RATE_SECONDS, 'NX');
    if (!first) throw tooMany('Location updates are coming too fast. The next one will get through.');

    const [me] = await db.select({ name: users.displayName }).from(users).where(eq(users.id, userId));
    const location: LiveLocation = {
      userId,
      displayName: me?.name ?? 'Someone',
      latitude: input.latitude,
      longitude: input.longitude,
      accuracy: input.accuracy ?? null,
      at: now.toISOString(),
      until: new Date(Date.parse(input.until)).toISOString(),
    };
    await redis.set(locationKey(tripId, userId), JSON.stringify(location), 'PX', left);
    await publishTripEvent(redis, {
      type: 'location.updated',
      tripId,
      entityId: userId,
      actorId: userId,
      payload: location,
      originClientId: origin,
    });
    return location;
  },

  /** Everyone sharing on the trip right now, among the people still on it. */
  async list(tripId: string, userId: string): Promise<LiveLocation[]> {
    await requireTripRole(db, tripId, userId, 'viewer');
    const keys: string[] = [];
    let cursor = '0';
    do {
      const [next, found] = await redis.scan(cursor, 'MATCH', locationKey(tripId, '*'), 'COUNT', 200);
      keys.push(...found);
      cursor = next;
    } while (cursor !== '0');
    if (keys.length === 0) return [];
    const members = new Set(
      (
        await db
          .select({ userId: tripMembers.userId })
          .from(tripMembers)
          .where(and(eq(tripMembers.tripId, tripId), isNull(tripMembers.leftAt)))
      ).map((m) => m.userId),
    );
    const values = await redis.mget(keys);
    return values.flatMap((v) => {
      const parsed = v ? LiveLocation.safeParse(JSON.parse(v)) : null;
      return parsed?.success && members.has(parsed.data.userId) ? [parsed.data] : [];
    });
  },

  async stop(tripId: string, userId: string, origin?: string) {
    await requireTripRole(db, tripId, userId, 'viewer');
    await stopSharing(redis, tripId, userId, userId, origin);
  },
});
