import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { changeLog, items, type Db } from '@tagalong/db';
import {
  estimateLeg,
  isLocated,
  movableCount,
  optimiseDay,
  positionsBetween,
  type DayOptimisation,
  type DayRoute,
  type ItineraryItem,
  type ReorderDayInput,
  type RouteLine,
  type TravelMode,
} from '@tagalong/shared';
import type { Redis } from 'ioredis';
import { requireTripRole } from '../../lib/access';
import { badRequest, conflict } from '../../lib/errors';
import { publishTripEvent } from '../../lib/events';
import type { Point } from '../../lib/geo';
import type { Routing } from '../../lib/routing';
import { toItem } from '../itinerary/service';

type Row = typeof items.$inferSelect;

/** Routes don't change with the plan, only with the roads: keep answers a month. */
const ROUTE_TTL = 30 * 24 * 60 * 60;

/** Plain byte order, the same as the database's "C" collation on positions. */
const byPosition = (a: Row, b: Row) =>
  a.position < b.position ? -1 : a.position > b.position ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

const pointOf = (r: Row): Point => ({ latitude: r.latitude!, longitude: r.longitude! });

/** The cache key for a list of points: the same stops in another order are another key. */
const spotsKey = (points: Point[]) => points.map((p) => `${p.longitude.toFixed(5)},${p.latitude.toFixed(5)}`).join(';');

/**
 * New positions for a day in `ordered` order. Items still at their old index
 * keep their keys; each run of moved ones gets fresh keys between its
 * neighbours. If the old keys tie (rare, from long ago), the day is renumbered.
 */
export const reorderedPositions = (ordered: Row[], oldIndex: Map<string, number>): string[] => {
  const positions = ordered.map((r) => r.position);
  const kept = ordered.map((r, i) => oldIndex.get(r.id) === i);
  try {
    for (let i = 0; i < ordered.length; ) {
      if (kept[i]) {
        i++;
        continue;
      }
      let j = i;
      while (j < ordered.length && !kept[j]) j++;
      positionsBetween(i > 0 ? positions[i - 1]! : null, j < ordered.length ? positions[j]! : null, j - i).forEach(
        (key, k) => (positions[i + k] = key),
      );
      i = j;
    }
    return positions;
  } catch {
    return positionsBetween(null, null, ordered.length);
  }
};

export const createDaysService = (db: Db, redis: Redis, routing: Routing) => {
  const dayRows = async (tripId: string, date: string) =>
    (
      await db
        .select()
        .from(items)
        .where(and(eq(items.tripId, tripId), eq(items.date, date), isNull(items.deletedAt)))
    ).sort(byPosition);

  const readCache = async <T>(key: string) => {
    const hit = await redis.get(key).catch(() => null);
    return hit ? (JSON.parse(hit) as T) : null;
  };
  const writeCache = (key: string, value: unknown) =>
    redis.set(key, JSON.stringify(value), 'EX', ROUTE_TTL).catch(() => undefined);

  /** Legs through the points in order, from the router, or estimated when it doesn't answer. */
  const legsThrough = async (mode: TravelMode, points: Point[]) => {
    type Answer = { legs: { distanceM: number; durationS: number }[]; geometry: RouteLine };
    const key = `geo:route:${mode}:${spotsKey(points)}`;
    const hit = await readCache<Answer>(key);
    if (hit) return { ...hit, estimated: false };
    try {
      const answer = await routing.route(mode, points);
      await writeCache(key, answer);
      return { ...answer, estimated: false };
    } catch {
      // Not cached, so the real answer replaces the guess as soon as the server is back.
      return {
        legs: points.slice(1).map((p, i) => estimateLeg(points[i]!, p, mode)),
        geometry: { type: 'LineString' as const, coordinates: points.map((p): [number, number] => [p.longitude, p.latitude]) },
        estimated: true,
      };
    }
  };

  /** Seconds from every point to every other, from the router or estimated. */
  const durationsBetween = async (mode: TravelMode, points: Point[]) => {
    const key = `geo:table:${mode}:${spotsKey(points)}`;
    const hit = await readCache<number[][]>(key);
    if (hit) return { durations: hit, estimated: false };
    try {
      const { durations } = await routing.table(mode, points);
      await writeCache(key, durations);
      return { durations, estimated: false };
    } catch {
      return { durations: points.map((a) => points.map((b) => estimateLeg(a, b, mode).durationS)), estimated: true };
    }
  };

  return {
    /** Travel between the day's stops in plan order. A stop without a location breaks the chain. */
    async route(tripId: string, date: string, userId: string, mode: TravelMode): Promise<DayRoute> {
      await requireTripRole(db, tripId, userId, 'viewer');
      const rows = await dayRows(tripId, date);
      const located = rows.map((r, i) => ({ r, i })).filter(({ r }) => isLocated(r));
      if (located.length < 2) {
        return { mode, legs: [], totalDistanceM: 0, totalDurationS: 0, geometry: null, estimated: false };
      }
      const { legs, geometry, estimated } = await legsThrough(mode, located.map(({ r }) => pointOf(r)));
      // One call covers every located stop; keep only the legs between neighbours on the list.
      const kept = located.slice(1).flatMap(({ r, i }, k) => {
        const from = located[k]!;
        return from.i === i - 1 ? [{ fromId: from.r.id, toId: r.id, ...legs[k]! }] : [];
      });
      return {
        mode,
        legs: kept,
        totalDistanceM: kept.reduce((sum, l) => sum + l.distanceM, 0),
        totalDurationS: kept.reduce((sum, l) => sum + l.durationS, 0),
        geometry,
        estimated,
      };
    },

    /** "Shortest order": a suggestion that keeps the first, timed and unlocated stops in place. */
    async optimise(tripId: string, date: string, userId: string, mode: TravelMode): Promise<DayOptimisation> {
      await requireTripRole(db, tripId, userId, 'editor');
      const rows = await dayRows(tripId, date);
      const stops = rows.map((r) => ({ id: r.id, latitude: r.latitude, longitude: r.longitude, startTime: r.startTime }));
      const current = rows.map((r) => r.id);
      if (movableCount(stops) < 2) return { mode, itemIds: current, beforeS: 0, afterS: 0, savedS: 0, estimated: false };

      const located = rows.map((r, i) => ({ r, i })).filter(({ r }) => isLocated(r));
      const { durations, estimated } = await durationsBetween(mode, located.map(({ r }) => pointOf(r)));
      // The solver wants every stop; unlocated ones never cost anything.
      const slot = new Map(located.map(({ i }, k) => [i, k]));
      const matrix = rows.map((_, a) => rows.map((__, b) => (slot.has(a) && slot.has(b) ? durations[slot.get(a)!]![slot.get(b)!]! : 0)));
      const { order, before, after } = optimiseDay(stops, matrix);
      return { mode, itemIds: order, beforeS: before, afterS: after, savedS: before - after, estimated };
    },

    /**
     * Puts the whole day in a new order in one go. Every item on the day must
     * be listed, at the version you saw; otherwise someone changed the day
     * meanwhile and you get 409 with the day as it is now.
     */
    async reorder(tripId: string, date: string, userId: string, input: ReorderDayInput, origin?: string) {
      await requireTripRole(db, tripId, userId, 'editor');
      const { itemIds, versions } = input;
      if (new Set(itemIds).size !== itemIds.length) throw badRequest('Each item can only appear once');
      if (itemIds.some((id) => versions[id] === undefined)) throw badRequest('Send the version of every item');

      const result = await db.transaction(async (tx) => {
        // Lock the day's items, and the listed ones wherever they are, until we're done.
        const listed = await tx.select().from(items).where(and(eq(items.tripId, tripId), inArray(items.id, itemIds))).for('update');
        const onDay = (
          await tx
            .select()
            .from(items)
            .where(and(eq(items.tripId, tripId), eq(items.date, date), isNull(items.deletedAt)))
            .for('update')
        ).sort(byPosition);

        for (const id of itemIds) {
          const row = listed.find((r) => r.id === id);
          if (!row) throw badRequest('That item isn’t on this trip');
          // Changed since you looked (moved, deleted, edited): a conflict, not a mistake.
          if (row.version !== versions[id]) return { stale: true as const };
          if (row.deletedAt || row.date !== date) throw badRequest('That item isn’t on this day');
        }
        // Someone added an item to the day meanwhile.
        if (onDay.some((r) => !itemIds.includes(r.id))) return { stale: true as const };

        const oldIndex = new Map(onDay.map((r, i) => [r.id, i]));
        const ordered = itemIds.map((id) => onDay.find((r) => r.id === id)!);
        const positions = reorderedPositions(ordered, oldIndex);

        const moved: Row[] = [];
        const all: Row[] = [];
        for (const [i, row] of ordered.entries()) {
          if (positions[i] === row.position) {
            all.push(row);
            continue;
          }
          const [updated] = await tx
            .update(items)
            .set({ position: positions[i]!, version: sql`${items.version} + 1` })
            .where(eq(items.id, row.id))
            .returning();
          await tx.insert(changeLog).values({ tripId, entity: 'item', entityId: row.id, op: 'upsert', changedBy: userId });
          moved.push(updated!);
          all.push(updated!);
        }
        return { stale: false as const, moved: moved.map(toItem), all: all.map(toItem) };
      });

      if (result.stale) {
        throw conflict('Someone changed this day while you were looking. Showing the latest order.', {
          current: (await dayRows(tripId, date)).map(toItem),
        });
      }
      if (result.moved.length > 0) {
        await publishTripEvent(redis, {
          type: 'day.reordered',
          tripId,
          entityId: tripId,
          actorId: userId,
          payload: { date, items: result.moved },
          originClientId: origin,
        });
      }
      return { items: result.all satisfies ItineraryItem[] };
    },
  };
};
