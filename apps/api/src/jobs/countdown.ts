import { and, asc, between, eq, isNotNull, isNull } from 'drizzle-orm';
import { bookings, countdownSent, devices, items, tripMembers, tripPlaces, trips, users, type Db } from '@tagalong/db';
import {
  BOOKING_TYPES,
  channelFor,
  countdownMessage,
  countdownStage,
  openMeteoDaily,
  placeForDate,
  planItemFor,
  wallClock,
  type BookingType,
  type CountdownFacts,
} from '@tagalong/shared';
import { readinessFor } from '../lib/readiness';
import { effectivePrefs, wants } from '../modules/notifications/service';
import { forgetDeadTokens, type PushSender } from './notify';

/** The hourly job that sends the countdown before trips. */
export const COUNTDOWN_JOB = 'countdown';

type DayWeather = CountdownFacts['weather'];
/** The forecast for one day at one spot, or null when there's none. */
export type WeatherLookup = (centre: { latitude: number; longitude: number }, date: string) => Promise<DayWeather>;

/** Open-Meteo, free and keyless, asked straight from the worker. */
export const openMeteoDay: WeatherLookup = async (centre, date) => {
  const { days } = await openMeteoDaily(fetch, centre, 'forecast', date, date);
  return days[0] ? { maxC: days[0].maxC, minC: days[0].minC, rainChance: days[0].rainChance } : null;
};

const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/**
 * "A week to Goa! 2 to-dos still open", "3 days to go · 14 items to pack",
 * "Tomorrow: Goa · weather 31°/24°", "Today's the day! First up: …". Runs
 * hourly; each person gets each stage once per trip, from its hour on their
 * own clock (their phone's time zone, else the trip's), if they want
 * countdowns and haven't muted the trip.
 */
export const queueCountdowns = async (
  { db, push, weather = openMeteoDay }: { db: Db; push: PushSender; weather?: WeatherLookup },
  now = new Date(),
) => {
  const utcToday = now.toISOString().slice(0, 10);
  const candidates = await db
    .select({
      tripId: trips.id,
      tripName: trips.name,
      startDate: trips.startDate,
      tripZone: trips.timezone,
      latitude: trips.latitude,
      longitude: trips.longitude,
      userId: tripMembers.userId,
      userZone: users.timezone,
    })
    .from(tripMembers)
    .innerJoin(trips, eq(trips.id, tripMembers.tripId))
    .innerJoin(users, eq(users.id, tripMembers.userId))
    .where(
      and(
        isNull(tripMembers.leftAt),
        isNull(trips.deletedAt),
        // Every time zone's dates sit within a day of UTC's; a week and a day covers the earliest stage.
        between(trips.startDate, addDays(utcToday, -1), addDays(utcToday, 8)),
      ),
    );

  // Looked up once per trip, whoever it's for.
  const weatherByTrip = new Map<string, Promise<DayWeather>>();
  const firstUpByTrip = new Map<string, Promise<CountdownFacts['firstUp']>>();

  const tripWeather = (c: (typeof candidates)[number]) => {
    if (!weatherByTrip.has(c.tripId)) {
      weatherByTrip.set(
        c.tripId,
        (async () => {
          const places = (await db.select().from(tripPlaces).where(eq(tripPlaces.tripId, c.tripId))).sort((a, b) =>
            a.position < b.position ? -1 : 1,
          );
          const first = placeForDate(places, c.startDate)?.place;
          const spot =
            first?.latitude != null && first.longitude != null
              ? { latitude: first.latitude, longitude: first.longitude }
              : c.latitude !== null && c.longitude !== null
                ? { latitude: c.latitude, longitude: c.longitude }
                : null;
          return spot ? weather(spot, c.startDate!).catch(() => null) : null;
        })(),
      );
    }
    return weatherByTrip.get(c.tripId)!;
  };

  /** The first booking or timed stop on the first day, whichever is earlier on the clock. */
  const firstUp = (c: (typeof candidates)[number]) => {
    if (!firstUpByTrip.has(c.tripId)) {
      firstUpByTrip.set(
        c.tripId,
        (async () => {
          const [booked, stops] = await Promise.all([
            db
              .select()
              .from(bookings)
              .where(and(eq(bookings.tripId, c.tripId), isNull(bookings.deletedAt), isNotNull(bookings.startsAt)))
              .orderBy(asc(bookings.startsAt)),
            db
              .select({ title: items.title, startTime: items.startTime })
              .from(items)
              .where(and(eq(items.tripId, c.tripId), eq(items.date, c.startDate!), isNull(items.deletedAt), isNotNull(items.startTime)))
              .orderBy(asc(items.startTime)),
          ]);
          const options = [
            ...booked.flatMap((b) => {
              if (!(BOOKING_TYPES as readonly string[]).includes(b.type)) return [];
              const local = wallClock(b.startsAt!.toISOString(), b.timezone);
              if (local.date !== c.startDate) return [];
              const shaped = planItemFor({
                type: b.type as BookingType,
                provider: b.provider,
                startsAt: b.startsAt!.toISOString(),
                timezone: b.timezone,
                details: (b.details ?? {}) as Record<string, unknown>,
              });
              return [{ title: shaped.title, time: local.time }];
            }),
            ...stops.map((s) => ({ title: s.title, time: s.startTime!.slice(0, 5) })),
          ].sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
          return options[0] ?? null;
        })(),
      );
    }
    return firstUpByTrip.get(c.tripId)!;
  };

  let sent = 0;
  for (const c of candidates) {
    const local = wallClock(now.toISOString(), c.userZone ?? c.tripZone ?? 'UTC');
    const stage = countdownStage(c.startDate!, local);
    if (!stage) continue;
    const prefs = (await effectivePrefs(db, [c.userId], c.tripId)).get(c.userId)!;
    if (!wants(prefs, 'countdown', now)) continue;
    const [already] = await db
      .select({ stage: countdownSent.stage })
      .from(countdownSent)
      .where(and(eq(countdownSent.tripId, c.tripId), eq(countdownSent.userId, c.userId), eq(countdownSent.stage, stage)));
    if (already) continue;

    const readiness = (await readinessFor(db, c.userId, [c.tripId])).get(c.tripId) ?? { packed: 0, packingTotal: 0, todosOpen: 0 };
    const message = countdownMessage(stage, {
      tripName: c.tripName,
      readiness,
      weather: stage === 'eve' ? await tripWeather(c) : null,
      firstUp: stage === 'day' ? await firstUp(c) : null,
    });
    // Nothing worth saying (a week out, all done): try again next hour, in case that changes.
    if (!message) continue;

    // Claimed before sending, so two runs at once can't both send it.
    const claimed = await db.insert(countdownSent).values({ tripId: c.tripId, userId: c.userId, stage }).onConflictDoNothing().returning();
    if (claimed.length === 0) continue;

    const tokens = await db
      .select({ id: devices.id, token: devices.pushToken })
      .from(devices)
      .where(and(eq(devices.userId, c.userId), isNotNull(devices.pushToken)));
    if (tokens.length === 0) continue;
    const tickets = await push.send(
      tokens.map((t) => ({
        to: t.token!,
        title: c.tripName,
        body: message.body,
        data: { url: message.opens === 'lists' ? `/trips/${c.tripId}/lists` : `/trips/${c.tripId}` },
        sound: 'default' as const,
        channelId: channelFor('countdown'),
      })),
    );
    await forgetDeadTokens(db, tokens, tickets);
    sent += 1;
  }
  return { sent };
};
