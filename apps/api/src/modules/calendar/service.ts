import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import { bookings, calendarFeeds, items, tripMembers, tripPlaces, trips, type Db } from '@tagalong/db';
import {
  BOOKING_TYPES,
  icsCalendar,
  planItemFor,
  timezoneForStop,
  type BookingType,
  type CalendarFeed,
  type IcsEvent,
  type NewCalendarFeed,
} from '@tagalong/shared';
import { requireTripRole } from '../../lib/access';
import { randomToken, sha256 } from '../../lib/crypto';
import { notFound } from '../../lib/errors';

const HOUR_MS = 3_600_000;

const dayAfter = (date: string) => new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

/** An hour after a wall-clock time, rolling over midnight: a stop with no end gets an hour. */
const hourLater = (date: string, time: string) => {
  const [h, m] = time.split(':').map(Number);
  return h! + 1 >= 24 ? { date: dayAfter(date), time: `${String(h! - 23).padStart(2, '0')}:${String(m).padStart(2, '0')}` } : { date, time: `${String(h! + 1).padStart(2, '0')}:${String(m).padStart(2, '0')}` };
};

const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/**
 * Trips, timed plan stops and bookings as calendar events. Each has a stable
 * UID ("item-<id>@tagalong") and its version as SEQUENCE, so a calendar that
 * subscribed replaces an event when it changes instead of adding another.
 */
export const createCalendarService = (db: Db, appUrl: string | null) => {
  const link = (path: string) => (appUrl ? `${appUrl.replace(/\/$/, '')}${path}` : null);

  const eventsFor = async (tripIds: string[], includeUntimed: boolean): Promise<IcsEvent[]> => {
    if (tripIds.length === 0) return [];
    const tripRows = await db
      .select({
        id: trips.id,
        name: trips.name,
        destination: trips.destination,
        startDate: trips.startDate,
        endDate: trips.endDate,
        timezone: trips.timezone,
        version: trips.version,
        updatedAt: trips.updatedAt,
      })
      .from(trips)
      .where(and(inArray(trips.id, tripIds), isNull(trips.deletedAt)));
    const ids = tripRows.map((t) => t.id);
    if (ids.length === 0) return [];
    const [placeRows, itemRows, bookingRows] = await Promise.all([
      db.select().from(tripPlaces).where(inArray(tripPlaces.tripId, ids)),
      db
        .select()
        .from(items)
        .where(and(inArray(items.tripId, ids), isNull(items.deletedAt), isNotNull(items.date))),
      db
        .select()
        .from(bookings)
        .where(and(inArray(bookings.tripId, ids), isNull(bookings.deletedAt), isNotNull(bookings.startsAt))),
    ]);
    // A booking's plan item would only repeat it.
    const booked = new Set(bookingRows.map((b) => b.itemId).filter(Boolean));
    const placesOf = (tripId: string) =>
      placeRows
        .filter((p) => p.tripId === tripId)
        .sort((a, b) => (a.position < b.position ? -1 : a.position > b.position ? 1 : 0))
        .map((p) => ({
          startDate: p.startDate,
          endDate: p.endDate,
          timezone: p.timezone,
          location: p.latitude !== null && p.longitude !== null ? { latitude: p.latitude, longitude: p.longitude } : null,
        }));

    const events: IcsEvent[] = [];
    for (const trip of tripRows) {
      if (trip.startDate) {
        events.push({
          uid: `trip-${trip.id}@tagalong`,
          sequence: trip.version,
          stamp: trip.updatedAt.toISOString(),
          summary: trip.name,
          start: { date: trip.startDate },
          end: { date: trip.endDate ?? trip.startDate },
          location: trip.destination,
          url: link(`/trips/${trip.id}`),
        });
      }
      const places = placesOf(trip.id);
      for (const item of itemRows.filter((i) => i.tripId === trip.id && !booked.has(i.id))) {
        const url = link(`/trips/${trip.id}/items/${item.id}`);
        const description = [item.notes, `${trip.name}${url ? `: ${url}` : ''}`].filter(Boolean).join('\n\n');
        const base = {
          uid: `item-${item.id}@tagalong`,
          sequence: item.version,
          stamp: item.updatedAt.toISOString(),
          summary: item.title,
          location: item.placeName,
          description,
          url,
        };
        if (item.startTime) {
          const tz = timezoneForStop(places, item.date, item) ?? trip.timezone ?? 'UTC';
          const start = item.startTime.slice(0, 5);
          const end = item.endTime
            ? { date: item.endTime.slice(0, 5) <= start ? dayAfter(item.date!) : item.date!, time: item.endTime.slice(0, 5) }
            : hourLater(item.date!, start);
          events.push({ ...base, start: { date: item.date!, time: start, tz }, end: { ...end, tz } });
        } else if (includeUntimed) {
          events.push({ ...base, start: { date: item.date! }, end: { date: item.date! } });
        }
      }
      for (const b of bookingRows.filter((r) => r.tripId === trip.id)) {
        if (!(BOOKING_TYPES as readonly string[]).includes(b.type)) continue;
        const details = (b.details ?? {}) as Record<string, unknown>;
        const startsAt = b.startsAt!.toISOString();
        const endsAt = b.endsAt?.toISOString() ?? null;
        const shaped = planItemFor({ type: b.type as BookingType, provider: b.provider, startsAt, endsAt, timezone: b.timezone, details });
        const url = link(`/trips/${trip.id}`);
        const description = [
          b.reference ? `Booking reference: ${b.reference}` : null,
          b.provider,
          `${trip.name}${url ? `: ${url}` : ''}`,
        ]
          .filter(Boolean)
          .join('\n');
        const base = { sequence: b.version, stamp: b.updatedAt.toISOString(), location: shaped.placeName, description, url };
        const hourAfter = (iso: string) => ({ instant: new Date(Date.parse(iso) + HOUR_MS).toISOString() });
        if (b.type === 'stay') {
          const name = b.provider ?? text(details.address) ?? 'your stay';
          events.push({ ...base, uid: `booking-${b.id}-in@tagalong`, summary: `Check in: ${name}`, start: { instant: startsAt }, end: hourAfter(startsAt) });
          if (endsAt) {
            events.push({ ...base, uid: `booking-${b.id}-out@tagalong`, summary: `Check out: ${name}`, start: { instant: endsAt }, end: hourAfter(endsAt) });
          }
        } else {
          events.push({
            ...base,
            uid: `booking-${b.id}@tagalong`,
            summary: shaped.title,
            start: { instant: startsAt },
            end: endsAt && endsAt > startsAt ? { instant: endsAt } : hourAfter(startsAt),
          });
        }
      }
    }
    return events;
  };

  /** Every trip I'm on now: leaving a trip (or being removed) takes it out of my calendar. */
  const myTripIds = async (userId: string) =>
    (
      await db
        .select({ id: tripMembers.tripId })
        .from(tripMembers)
        .where(and(eq(tripMembers.userId, userId), isNull(tripMembers.leftAt)))
    ).map((r) => r.id);

  const statusOf = (row: typeof calendarFeeds.$inferSelect | undefined): CalendarFeed => ({
    active: !!row,
    includeUntimed: row?.includeUntimed ?? false,
    createdAt: row?.createdAt.toISOString() ?? null,
    lastFetchedAt: row?.lastFetchedAt?.toISOString() ?? null,
  });
  const rowOf = async (userId: string) => (await db.select().from(calendarFeeds).where(eq(calendarFeeds.userId, userId)))[0];

  return {
    /** The feed a calendar app reads. An unknown or replaced token is 404, like any wrong address. */
    async feed(token: string) {
      const [row] = await db.select().from(calendarFeeds).where(eq(calendarFeeds.tokenHash, sha256(token)));
      if (!row) throw notFound('No such calendar');
      await db.update(calendarFeeds).set({ lastFetchedAt: new Date() }).where(eq(calendarFeeds.userId, row.userId));
      return icsCalendar({ name: 'Tagalong trips', events: await eventsFor(await myTripIds(row.userId), row.includeUntimed) });
    },

    /** One trip, for "Download calendar (.ics)". */
    async tripFile(tripId: string, userId: string) {
      await requireTripRole(db, tripId, userId, 'viewer');
      const [trip] = await db.select({ name: trips.name }).from(trips).where(eq(trips.id, tripId));
      const includeUntimed = (await rowOf(userId))?.includeUntimed ?? false;
      return { name: trip!.name, ics: icsCalendar({ name: trip!.name, events: await eventsFor([tripId], includeUntimed) }) };
    },

    async status(userId: string) {
      return statusOf(await rowOf(userId));
    },

    /** A new link; the old one, if any, stops working at once. The token is only ever shown here. */
    async create(userId: string): Promise<NewCalendarFeed> {
      const token = randomToken();
      const [row] = await db
        .insert(calendarFeeds)
        .values({ userId, tokenHash: sha256(token) })
        .onConflictDoUpdate({
          target: calendarFeeds.userId,
          set: { tokenHash: sha256(token), createdAt: new Date(), lastFetchedAt: null },
        })
        .returning();
      return { ...statusOf(row), token };
    },

    async update(userId: string, includeUntimed: boolean) {
      const [row] = await db.update(calendarFeeds).set({ includeUntimed }).where(eq(calendarFeeds.userId, userId)).returning();
      if (!row) throw notFound('Turn on the calendar link first');
      return statusOf(row);
    },

    /** Stop sharing: the link stops working. */
    async remove(userId: string) {
      await db.delete(calendarFeeds).where(eq(calendarFeeds.userId, userId));
    },
  };
};
