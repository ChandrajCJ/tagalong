import { and, asc, between, eq, isNotNull, isNull, lt, sql } from 'drizzle-orm';
import { devices, items, journalEntries, journalPushesSent, tripMembers, tripPlaces, trips, users, type Db } from '@tagalong/db';
import {
  channelFor,
  dayNumberOf,
  dayPlaceLabel,
  journalPrompt,
  memoryFor,
  memoryLine,
  placeForDate,
  promptDay,
  recapDue,
  wallClock,
} from '@tagalong/shared';
import { effectivePrefs, wants } from '../modules/notifications/service';
import { forgetDeadTokens, type PushSender } from './notify';

/** The hourly job behind the evening prompt, "On this day" and the recap push. */
export const JOURNAL_JOB = 'journal';

/** A trip's last day: its end date, or its start date for a one-day trip. */
const lastDay = sql<string>`coalesce(${trips.endDate}, ${trips.startDate})`;

const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

type Kind = 'prompt' | 'memory' | 'recap';

/**
 * Claims the push first, so two runs at once can't both send it, then sends
 * it to every phone the person has. Returns whether it went.
 */
const sendOnce = async (
  db: Db,
  push: PushSender,
  claim: { tripId: string; userId: string; kind: Kind; day: string },
  message: { title: string; body: string; url: string; channel: 'journal' | 'memories' },
) => {
  const claimed = await db.insert(journalPushesSent).values(claim).onConflictDoNothing().returning();
  if (claimed.length === 0) return false;
  const tokens = await db
    .select({ id: devices.id, token: devices.pushToken })
    .from(devices)
    .where(and(eq(devices.userId, claim.userId), isNotNull(devices.pushToken)));
  if (tokens.length === 0) return false;
  const tickets = await push.send(
    tokens.map((t) => ({
      to: t.token!,
      title: message.title,
      body: message.body,
      data: { url: message.url },
      sound: 'default' as const,
      channelId: channelFor(message.channel),
    })),
  );
  await forgetDeadTokens(db, tokens, tickets);
  return true;
};

const placesOf = async (db: Db, tripId: string) =>
  (await db.select().from(tripPlaces).where(eq(tripPlaces.tripId, tripId))).sort((a, b) => (a.position < b.position ? -1 : 1));

/**
 * "Day 2 in Goa: what was the best moment?" From each person's chosen time
 * (20:30 unless they changed it) on the trip's clock, during the trip, once a
 * day, unless they've already written that day, turned it off or muted the trip.
 */
export const queueJournalPrompts = async ({ db, push }: { db: Db; push: PushSender }, now = new Date()) => {
  const utcToday = now.toISOString().slice(0, 10);
  const candidates = await db
    .select({
      tripId: trips.id,
      tripName: trips.name,
      startDate: trips.startDate,
      endDate: trips.endDate,
      tripZone: trips.timezone,
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
        isNotNull(trips.startDate),
        // Every time zone's date is within a day of UTC's.
        lt(trips.startDate, addDays(utcToday, 2)),
        between(lastDay, addDays(utcToday, -1), addDays(utcToday, 400)),
      ),
    );

  let sent = 0;
  for (const c of candidates) {
    const local = wallClock(now.toISOString(), c.tripZone ?? c.userZone ?? 'UTC');
    const prefs = (await effectivePrefs(db, [c.userId], c.tripId)).get(c.userId)!;
    if (!wants(prefs, 'journal', now)) continue;
    const day = promptDay(local, c, prefs.journalTime);
    if (!day) continue;
    const [wrote] = await db
      .select({ id: journalEntries.id })
      .from(journalEntries)
      .where(
        and(
          eq(journalEntries.tripId, c.tripId),
          eq(journalEntries.authorId, c.userId),
          eq(journalEntries.date, day),
          isNull(journalEntries.deletedAt),
        ),
      )
      .limit(1);
    if (wrote) continue;
    const place = placeForDate(await placesOf(db, c.tripId), day);
    const city = place ? dayPlaceLabel(place) : null;
    const went = await sendOnce(
      db,
      push,
      { tripId: c.tripId, userId: c.userId, kind: 'prompt', day },
      {
        title: c.tripName,
        body: journalPrompt(dayNumberOf(c.startDate, c.endDate, day)!, city),
        url: `/trips/${c.tripId}/journal/${day}`,
        channel: 'journal',
      },
    );
    if (went) sent += 1;
  }
  return { sent };
};

/**
 * "A year ago today you were at Dudhsagar Falls", from 10:00 on the person's
 * own clock, once a day per trip, for trips they're still on.
 */
export const queueMemories = async ({ db, push }: { db: Db; push: PushSender }, now = new Date()) => {
  const utcToday = now.toISOString().slice(0, 10);
  const candidates = await db
    .select({
      tripId: trips.id,
      tripName: trips.name,
      startDate: trips.startDate,
      endDate: trips.endDate,
      tripZone: trips.timezone,
      userId: tripMembers.userId,
      userZone: users.timezone,
    })
    .from(tripMembers)
    .innerJoin(trips, eq(trips.id, tripMembers.tripId))
    .innerJoin(users, eq(users.id, tripMembers.userId))
    // At least a year back; memoryFor checks the exact day.
    .where(and(isNull(tripMembers.leftAt), isNull(trips.deletedAt), lt(trips.startDate, addDays(utcToday, -363))));

  let sent = 0;
  for (const c of candidates) {
    const local = wallClock(now.toISOString(), c.userZone ?? c.tripZone ?? 'UTC');
    if (local.time < '10:00') continue;
    const match = memoryFor(c, local.date);
    if (!match) continue;
    const prefs = (await effectivePrefs(db, [c.userId], c.tripId)).get(c.userId)!;
    if (!wants(prefs, 'memories', now)) continue;
    const [stop] = await db
      .select({ title: items.title, placeName: items.placeName })
      .from(items)
      .where(and(eq(items.tripId, c.tripId), eq(items.date, match.date), isNull(items.deletedAt), isNotNull(items.latitude)))
      .orderBy(asc(items.position))
      .limit(1);
    const place = placeForDate(await placesOf(db, c.tripId), match.date);
    const went = await sendOnce(
      db,
      push,
      { tripId: c.tripId, userId: c.userId, kind: 'memory', day: local.date },
      {
        title: c.tripName,
        body: memoryLine(match.yearsAgo, { stop: stop?.title ?? null, city: place ? dayPlaceLabel(place) : null }),
        url: `/trips/${c.tripId}/journal/${match.date}`,
        channel: 'memories',
      },
    );
    if (went) sent += 1;
  }
  return { sent };
};

/** "Your Goa recap is ready ✨", the morning after a trip's last day (9:00, trip's clock). */
export const queueRecaps = async ({ db, push }: { db: Db; push: PushSender }, now = new Date()) => {
  const utcToday = now.toISOString().slice(0, 10);
  const candidates = await db
    .select({
      tripId: trips.id,
      tripName: trips.name,
      endDate: lastDay,
      tripZone: trips.timezone,
      userId: tripMembers.userId,
      userZone: users.timezone,
    })
    .from(tripMembers)
    .innerJoin(trips, eq(trips.id, tripMembers.tripId))
    .innerJoin(users, eq(users.id, tripMembers.userId))
    .where(and(isNull(tripMembers.leftAt), isNull(trips.deletedAt), between(lastDay, addDays(utcToday, -8), utcToday)));

  let sent = 0;
  for (const c of candidates) {
    const local = wallClock(now.toISOString(), c.tripZone ?? c.userZone ?? 'UTC');
    if (!recapDue(c.endDate, local)) continue;
    const prefs = (await effectivePrefs(db, [c.userId], c.tripId)).get(c.userId)!;
    if (!wants(prefs, 'memories', now)) continue;
    const went = await sendOnce(
      db,
      push,
      { tripId: c.tripId, userId: c.userId, kind: 'recap', day: c.endDate! },
      { title: c.tripName, body: `Your ${c.tripName} recap is ready ✨`, url: `/trips/${c.tripId}/recap`, channel: 'memories' },
    );
    if (went) sent += 1;
  }
  return { sent };
};

/** All three, from one hourly job. */
export const runJournalJob = async (deps: { db: Db; push: PushSender }, now = new Date()) => ({
  prompts: (await queueJournalPrompts(deps, now)).sent,
  memories: (await queueMemories(deps, now)).sent,
  recaps: (await queueRecaps(deps, now)).sent,
});
