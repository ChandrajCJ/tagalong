import { and, asc, eq, inArray, isNotNull, isNull, ne, or, sql } from 'drizzle-orm';
import {
  changeLog,
  channels,
  expenses,
  expenseSplits,
  ideas,
  ideaVotes,
  items,
  journalComments,
  journalEntries,
  journalReactions,
  journalRecaps,
  messages,
  photoFavourites,
  photos,
  reactions,
  tripMembers,
  tripPlaces,
  trips,
  users,
  type Db,
} from '@tagalong/db';
import {
  AddJournalCommentInput,
  CreateJournalEntryInput,
  dayHeader,
  dayNumberOf,
  dayPlaceLabel,
  datesBetween,
  memoryFor,
  newId,
  placeForDate,
  SaveToJournalInput,
  tripOver,
  tripRecap,
  UpdateJournalEntryInput,
  wallClock,
  type DayHeader,
  type JournalComment,
  type JournalDay,
  type JournalDays,
  type JournalEntry,
  type Memory,
  type Photo,
  type RecapData,
  type TripRecap,
} from '@tagalong/shared';
import type { Redis } from 'ioredis';
import type { z } from 'zod';
import { requireTripRole } from '../../lib/access';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors';
import { publishTripEvent } from '../../lib/events';
import type { Storage } from '../../lib/storage';
import { IN_ALBUM } from '../photos/service';

type CreateEntry = z.output<typeof CreateJournalEntryInput>;
type UpdateEntry = z.output<typeof UpdateJournalEntryInput>;
type AddComment = z.output<typeof AddJournalCommentInput>;
type SaveToJournal = z.output<typeof SaveToJournalInput>;
type EntryRow = typeof journalEntries.$inferSelect;

/** Signs photo links for one viewer; the photos service's `byIds`. */
export type PhotoSigner = (tripId: string, ids: string[], userId: string) => Promise<Photo[]>;

/** What one person may read: every group entry, and their own private ones. Nobody else's, ever. */
const readableBy = (userId: string) =>
  and(isNull(journalEntries.deletedAt), or(eq(journalEntries.visibility, 'group'), eq(journalEntries.authorId, userId)));

export const createJournalService = (db: Db, redis: Redis, signPhotos: PhotoSigner, storage?: Storage, ttl = 600) => {
  const tripRow = async (tripId: string) => {
    const [trip] = await db.select().from(trips).where(eq(trips.id, tripId));
    if (!trip) throw notFound('Trip not found');
    return trip;
  };

  const placesOf = async (tripId: string) =>
    (await db.select().from(tripPlaces).where(eq(tripPlaces.tripId, tripId))).sort((a, b) => (a.position < b.position ? -1 : 1));

  const headcountOf = async (tripId: string) => {
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(tripMembers)
      .where(and(eq(tripMembers.tripId, tripId), isNull(tripMembers.leftAt)));
    return row?.n ?? 1;
  };

  /** Tells open day pages to fetch again. Only for group entries: a private one is nobody else's news. */
  const announce = (tripId: string, actorId: string, entry: { id: string; date: string }, origin?: string) =>
    publishTripEvent(redis, {
      type: 'journal.updated',
      tripId,
      entityId: entry.id,
      actorId,
      payload: { date: entry.date, entryId: entry.id },
      originClientId: origin,
    });

  /** An entry this person may read, or 404 (a private entry of someone else's doesn't exist for them). */
  const loadReadable = async (entryId: string, userId: string) => {
    const [row] = await db
      .select()
      .from(journalEntries)
      .where(and(eq(journalEntries.id, entryId), readableBy(userId)));
    if (!row) throw notFound('That entry no longer exists');
    const role = await requireTripRole(db, row.tripId, userId, 'viewer');
    return { row, role };
  };

  /** Photos from this trip's album, chat or journal only, still there. */
  const checkMedia = async (tripId: string, mediaIds: string[]) => {
    if (mediaIds.length === 0) return;
    const found = await db
      .select({ id: photos.id })
      .from(photos)
      .where(and(eq(photos.tripId, tripId), inArray(photos.id, mediaIds), ne(photos.source, 'cover'), isNull(photos.deletedAt)));
    if (found.length !== new Set(mediaIds).size) throw badRequest('Those photos aren’t on this trip');
  };

  /** Entry rows to what the phone shows, with names, photos, reactions, comments and quotes. */
  const hydrate = async (tripId: string, rows: EntryRow[], userId: string): Promise<JournalEntry[]> => {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const authorIds = [...new Set(rows.map((r) => r.authorId))];
    const [authorRows, reactionRows, commentRows, media] = await Promise.all([
      db.select({ id: users.id, name: users.displayName }).from(users).where(inArray(users.id, authorIds)),
      db
        .select({
          entryId: journalReactions.entryId,
          emoji: journalReactions.emoji,
          count: sql<number>`count(*)::int`,
          mine: sql<boolean>`bool_or(${journalReactions.userId} = ${userId})`,
        })
        .from(journalReactions)
        .where(inArray(journalReactions.entryId, ids))
        .groupBy(journalReactions.entryId, journalReactions.emoji),
      db
        .select({ comment: journalComments, authorName: users.displayName })
        .from(journalComments)
        .innerJoin(users, eq(users.id, journalComments.authorId))
        .where(and(inArray(journalComments.entryId, ids), isNull(journalComments.deletedAt)))
        .orderBy(asc(journalComments.createdAt)),
      signPhotos(tripId, rows.flatMap((r) => r.mediaIds), userId),
    ]);
    const sourceIds = rows.map((r) => r.sourceMessageId).filter((id): id is string => !!id);
    const sources = sourceIds.length
      ? await db
          .select({ id: messages.id, senderId: messages.senderId, senderName: users.displayName, createdAt: messages.createdAt })
          .from(messages)
          .leftJoin(users, eq(users.id, messages.senderId))
          .where(inArray(messages.id, sourceIds))
      : [];
    const nameOf = new Map(authorRows.map((a) => [a.id, a.name]));
    const photoOf = new Map(media.map((p) => [p.id, p]));

    return rows.map((r) => {
      const source = r.kind === 'quote' ? sources.find((s) => s.id === r.sourceMessageId) : undefined;
      return {
        id: r.id,
        tripId: r.tripId,
        authorId: r.authorId,
        authorName: nameOf.get(r.authorId) ?? 'Someone',
        date: r.date,
        kind: r.kind as JournalEntry['kind'],
        body: r.body,
        mood: r.mood as JournalEntry['mood'],
        visibility: r.visibility as JournalEntry['visibility'],
        mediaIds: r.mediaIds,
        media: r.mediaIds.flatMap((id) => (photoOf.has(id) ? [photoOf.get(id)!] : [])),
        place: r.placeLabel
          ? { label: r.placeLabel, latitude: r.latitude, longitude: r.longitude, placeRef: r.placeRef }
          : null,
        quote:
          r.kind === 'quote'
            ? {
                messageId: r.sourceMessageId,
                senderId: source?.senderId ?? null,
                senderName: source?.senderName ?? null,
                sentAt: source?.createdAt.toISOString() ?? null,
              }
            : null,
        reactions: reactionRows
          .filter((x) => x.entryId === r.id)
          .map(({ emoji, count, mine }) => ({ emoji, count, mine })),
        comments: commentRows
          .filter((c) => c.comment.entryId === r.id)
          .map(
            (c): JournalComment => ({
              id: c.comment.id,
              entryId: c.comment.entryId,
              authorId: c.comment.authorId,
              authorName: c.authorName,
              body: c.comment.body,
              createdAt: c.comment.createdAt.toISOString(),
            }),
          ),
        version: r.version,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      };
    });
  };

  const one = async (row: EntryRow, userId: string) => (await hydrate(row.tripId, [row], userId))[0]!;

  /** The auto-filled header: plan, photos, chat, money and ideas of one day, no typing. */
  const header = async (tripId: string, date: string, userId: string): Promise<DayHeader> => {
    const [trip, places, headcount] = await Promise.all([tripRow(tripId), placesOf(tripId), headcountOf(tripId)]);
    const tz = trip.timezone ?? 'UTC';
    const day = placeForDate(places, date);
    const spot = day?.place.latitude != null && day.place.longitude != null ? day.place : trip;
    const [stopRows, photoRows, messageRows, expenseRows, ideaRows] = await Promise.all([
      db
        .select()
        .from(items)
        .where(and(eq(items.tripId, tripId), eq(items.date, date), isNull(items.deletedAt)))
        .orderBy(asc(items.position), asc(items.id)),
      db
        .select({
          id: photos.id,
          kind: photos.kind,
          takenAt: photos.takenAt,
          favourites: sql<number>`(select count(*)::int from ${photoFavourites} f where f.photo_id = ${photos.id})`,
        })
        .from(photos)
        .where(
          and(
            eq(photos.tripId, tripId),
            inArray(photos.source, [...IN_ALBUM]),
            eq(photos.status, 'ready'),
            isNull(photos.deletedAt),
            sql`${photos.takenAt}::date = ${date}::date`,
          ),
        ),
      db
        .select({ id: messages.id, createdAt: messages.createdAt })
        .from(messages)
        .innerJoin(channels, and(eq(channels.id, messages.channelId), eq(channels.kind, 'trip')))
        .where(
          and(
            eq(messages.tripId, tripId),
            ne(messages.kind, 'system'),
            isNull(messages.deletedAt),
            sql`(${messages.createdAt} at time zone ${tz})::date = ${date}::date`,
          ),
        ),
      db
        .select({ baseAmountMinor: expenses.baseAmountMinor })
        .from(expenses)
        .where(and(eq(expenses.tripId, tripId), eq(expenses.spentOn, date), isNull(expenses.deletedAt))),
      db
        .select({
          id: ideas.id,
          title: ideas.title,
          itemDate: items.date,
          votes: sql<number>`(select count(*)::int from ${ideaVotes} v where v.idea_id = ${ideas.id} and v.value = 'up')`,
        })
        .from(ideas)
        .innerJoin(items, and(eq(items.id, ideas.promotedItemId), isNull(items.deletedAt)))
        .where(and(eq(ideas.tripId, tripId), isNull(ideas.deletedAt), eq(items.date, date))),
    ]);

    const built = dayHeader({
      date,
      trip: { startDate: trip.startDate, endDate: trip.endDate, currency: trip.baseCurrency, headcount },
      city: day ? dayPlaceLabel(day) : null,
      centre: spot.latitude != null && spot.longitude != null ? { latitude: spot.latitude, longitude: spot.longitude } : null,
      stops: stopRows.map((s) => ({
        id: s.id,
        title: s.title,
        type: s.type,
        startTime: s.startTime?.slice(0, 5) ?? null,
        placeName: s.placeName,
        latitude: s.latitude,
        longitude: s.longitude,
      })),
      photos: photoRows.map((p) => ({ ...p, kind: p.kind as 'photo' | 'video' })),
      messages: messageRows.map((m) => ({ id: m.id, createdAt: m.createdAt.toISOString() })),
      expenses: expenseRows,
      ideas: ideaRows,
    });
    const { topPhotoIds, ...rest } = built;
    return { ...rest, topPhotos: await signPhotos(tripId, topPhotoIds, userId) };
  };

  /** Changes on the trip since the recap was worked out, cheaply: if any of these moved, work it out again. */
  const recapStamp = async (tripId: string) => {
    const [row] = await db.execute<{ stamp: string }>(sql`
      select concat_ws(':',
        (select coalesce(max(seq), 0) from sync.change_log where trip_id = ${tripId}),
        (select count(*) from media.photo_favourites f join media.photos p on p.id = f.photo_id where p.trip_id = ${tripId}),
        (select count(*) from chat.messages where trip_id = ${tripId} and deleted_at is null),
        (select count(*) from chat.reactions r join chat.messages m on m.id = r.message_id where m.trip_id = ${tripId}),
        (select count(*) from journal.reactions r join journal.entries e on e.id = r.entry_id where e.trip_id = ${tripId}),
        (select max(updated_at)::text from journal.entries where trip_id = ${tripId})
      ) as stamp`);
    return String(row?.stamp ?? '');
  };

  /** The recap's numbers from every row of the trip that's visible to the whole group. */
  const computeRecap = async (tripId: string): Promise<RecapData> => {
    const [trip, places] = await Promise.all([tripRow(tripId), placesOf(tripId)]);
    const [itemRows, photoRows, messageRows, reactionRows, journalReactionRows, expenseRows, entryRows] = await Promise.all([
      db
        .select({ date: items.date, title: items.title, latitude: items.latitude, longitude: items.longitude })
        .from(items)
        .where(and(eq(items.tripId, tripId), isNull(items.deletedAt), isNotNull(items.date)))
        .orderBy(asc(items.date), asc(items.position), asc(items.id)),
      db
        .select({
          id: photos.id,
          kind: photos.kind,
          takenAt: photos.takenAt,
          favourites: sql<number>`(select count(*)::int from ${photoFavourites} f where f.photo_id = ${photos.id})`,
        })
        .from(photos)
        .where(and(eq(photos.tripId, tripId), inArray(photos.source, [...IN_ALBUM]), eq(photos.status, 'ready'), isNull(photos.deletedAt))),
      db
        .select({ body: messages.body })
        .from(messages)
        .where(and(eq(messages.tripId, tripId), ne(messages.kind, 'system'), isNull(messages.deletedAt))),
      db
        .select({ emoji: reactions.emoji })
        .from(reactions)
        .innerJoin(messages, eq(messages.id, reactions.messageId))
        .where(eq(messages.tripId, tripId)),
      db
        .select({ emoji: journalReactions.emoji })
        .from(journalReactions)
        .innerJoin(journalEntries, eq(journalEntries.id, journalReactions.entryId))
        .where(and(eq(journalEntries.tripId, tripId), eq(journalEntries.visibility, 'group'))),
      db
        .select({ id: expenses.id, description: expenses.description, baseAmountMinor: expenses.baseAmountMinor })
        .from(expenses)
        .where(and(eq(expenses.tripId, tripId), isNull(expenses.deletedAt))),
      // Never a private entry: the recap is the same for everyone.
      db
        .select()
        .from(journalEntries)
        .where(and(eq(journalEntries.tripId, tripId), eq(journalEntries.visibility, 'group'), isNull(journalEntries.deletedAt)))
        .orderBy(asc(journalEntries.date), asc(journalEntries.createdAt)),
    ]);
    const splitRows = expenseRows.length
      ? await db
          .select()
          .from(expenseSplits)
          .where(inArray(expenseSplits.expenseId, expenseRows.map((e) => e.id)))
      : [];
    return tripRecap({
      trip: { startDate: trip.startDate, endDate: trip.endDate },
      places,
      items: itemRows,
      photos: photoRows.map((p) => ({ ...p, kind: p.kind as 'photo' | 'video' })),
      messages: messageRows,
      reactions: [...reactionRows, ...journalReactionRows],
      expenses: expenseRows.map((e) => ({ ...e, splits: splitRows.filter((s) => s.expenseId === e.id) })),
      entries: entryRows,
    });
  };

  return {
    /** The trip's days for the journal list, with how many entries each has (that I can see) and who wrote. */
    async days(tripId: string, userId: string, range: { from?: string; to?: string } = {}): Promise<JournalDays> {
      await requireTripRole(db, tripId, userId, 'viewer');
      const [trip, places] = await Promise.all([tripRow(tripId), placesOf(tripId)]);
      const counted = await db
        .select({
          date: journalEntries.date,
          count: sql<number>`count(*)::int`,
          writers: sql<string[]>`array_agg(distinct ${journalEntries.authorId}) filter (where ${journalEntries.visibility} = 'group' or ${journalEntries.authorId} = ${userId})`,
        })
        .from(journalEntries)
        .where(and(eq(journalEntries.tripId, tripId), readableBy(userId)))
        .groupBy(journalEntries.date);
      const tripDays = trip.startDate ? datesBetween(trip.startDate, trip.endDate ?? trip.startDate) : [];
      const all = [...new Set([...tripDays, ...counted.map((c) => c.date)])]
        .filter((d) => (!range.from || d >= range.from) && (!range.to || d <= range.to))
        .sort();
      return {
        days: all.map((date) => {
          const c = counted.find((x) => x.date === date);
          const day = placeForDate(places, date);
          return {
            date,
            dayNumber: dayNumberOf(trip.startDate, trip.endDate, date),
            city: day ? dayPlaceLabel(day) : null,
            entryCount: c?.count ?? 0,
            writers: c?.writers ?? [],
          };
        }),
      };
    },

    /** One day page: the header, then entries oldest first. */
    async day(tripId: string, userId: string, date: string): Promise<JournalDay> {
      await requireTripRole(db, tripId, userId, 'viewer');
      const rows = await db
        .select()
        .from(journalEntries)
        .where(and(eq(journalEntries.tripId, tripId), eq(journalEntries.date, date), readableBy(userId)))
        .orderBy(asc(journalEntries.createdAt), asc(journalEntries.id));
      // My own private entry shows my face to me; nobody else learns of it.
      const writers = [...new Set(rows.filter((r) => r.visibility === 'group' || r.authorId === userId).map((r) => r.authorId))];
      return { header: await header(tripId, date, userId), entries: await hydrate(tripId, rows, userId), writers };
    },

    /** Anyone on the trip, viewers too: it's their memory as well. Retrying with the same id adds one entry. */
    async create(tripId: string, userId: string, input: CreateEntry, origin?: string) {
      await requireTripRole(db, tripId, userId, 'viewer');
      await checkMedia(tripId, input.mediaIds);
      const id = input.id ?? newId();
      const result = await db.transaction(async (tx) => {
        const [inserted] = await tx
          .insert(journalEntries)
          .values({
            id,
            tripId,
            authorId: userId,
            date: input.date,
            kind: 'note',
            body: input.body,
            mood: input.mood,
            visibility: input.visibility,
            mediaIds: input.mediaIds,
            placeLabel: input.place?.label ?? null,
            latitude: input.place?.latitude ?? null,
            longitude: input.place?.longitude ?? null,
            placeRef: input.place?.placeRef ?? null,
          })
          .onConflictDoNothing()
          .returning();
        if (!inserted) {
          const [existing] = await tx.select().from(journalEntries).where(eq(journalEntries.id, id));
          if (!existing || existing.tripId !== tripId || existing.authorId !== userId) {
            throw conflict('An entry with that id already exists');
          }
          return { row: existing, created: false };
        }
        await tx.insert(changeLog).values({ tripId, entity: 'journal_entry', entityId: id, op: 'upsert', changedBy: userId });
        return { row: inserted, created: true };
      });
      if (result.created && result.row.visibility === 'group') await announce(tripId, userId, result.row, origin);
      return { entry: await one(result.row, userId), created: result.created };
    },

    /** Only the author edits, any time. A stale `version` gets the current copy back. */
    async update(entryId: string, userId: string, input: UpdateEntry, origin?: string) {
      const { row: current } = await loadReadable(entryId, userId);
      if (current.authorId !== userId) throw forbidden('Only the person who wrote this can change it');
      const { version, place, ...fields } = input;
      if (fields.mediaIds) await checkMedia(current.tripId, fields.mediaIds);
      if (current.kind === 'quote' && fields.body !== undefined && fields.body !== current.body) {
        throw badRequest('A quote keeps what was said. Add a note of your own instead.');
      }
      const updated = await db.transaction(async (tx) => {
        const [row] = await tx
          .update(journalEntries)
          .set({
            ...Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)),
            ...(place !== undefined
              ? {
                  placeLabel: place?.label ?? null,
                  latitude: place?.latitude ?? null,
                  longitude: place?.longitude ?? null,
                  placeRef: place?.placeRef ?? null,
                }
              : {}),
            version: sql`${journalEntries.version} + 1`,
          })
          .where(and(eq(journalEntries.id, entryId), eq(journalEntries.version, version), isNull(journalEntries.deletedAt)))
          .returning();
        if (!row) return null;
        await tx.insert(changeLog).values({ tripId: row.tripId, entity: 'journal_entry', entityId: entryId, op: 'upsert', changedBy: userId });
        return row;
      });
      if (!updated) {
        const { row: latest } = await loadReadable(entryId, userId);
        throw conflict('You changed this on another device. Showing the latest version.', { current: await one(latest, userId) });
      }
      // Made private, or moved to another day: the group's pages drop it.
      if (current.visibility === 'group') await announce(current.tripId, userId, current, origin);
      if (updated.visibility === 'group' && (current.visibility !== 'group' || updated.date !== current.date)) {
        await announce(updated.tripId, userId, updated, origin);
      }
      return one(updated, userId);
    },

    /** The author, or a trip owner keeping the journal kind (owners never see others' private entries). */
    async remove(entryId: string, userId: string, origin?: string) {
      const { row, role } = await loadReadable(entryId, userId);
      if (row.authorId !== userId && role !== 'owner') throw forbidden('Only the person who wrote this, or a trip owner, can delete it');
      const deleted = await db.transaction(async (tx) => {
        const [gone] = await tx
          .update(journalEntries)
          .set({ deletedAt: new Date(), version: sql`${journalEntries.version} + 1` })
          .where(and(eq(journalEntries.id, entryId), isNull(journalEntries.deletedAt)))
          .returning({ id: journalEntries.id });
        if (!gone) return false;
        await tx.insert(changeLog).values({ tripId: row.tripId, entity: 'journal_entry', entityId: entryId, op: 'delete', changedBy: userId });
        return true;
      });
      if (deleted && row.visibility === 'group') await announce(row.tripId, userId, row, origin);
    },

    /** A reaction on a group entry, on or off; the same emoji as chat. */
    async toggleReaction(entryId: string, userId: string, emoji: string, origin?: string) {
      const { row } = await loadReadable(entryId, userId);
      if (row.visibility !== 'group') throw badRequest('Only entries shared with the group take reactions');
      const removed = await db
        .delete(journalReactions)
        .where(and(eq(journalReactions.entryId, entryId), eq(journalReactions.userId, userId), eq(journalReactions.emoji, emoji)))
        .returning({ emoji: journalReactions.emoji });
      if (removed.length === 0) await db.insert(journalReactions).values({ entryId, userId, emoji }).onConflictDoNothing();
      await announce(row.tripId, userId, row, origin);
      return one(row, userId);
    },

    /** A short reply under a group entry. Retrying with the same id adds one. */
    async addComment(entryId: string, userId: string, input: AddComment, origin?: string) {
      const { row } = await loadReadable(entryId, userId);
      if (row.visibility !== 'group') throw badRequest('Only entries shared with the group take comments');
      const id = input.id ?? newId();
      const [inserted] = await db
        .insert(journalComments)
        .values({ id, entryId, authorId: userId, body: input.body })
        .onConflictDoNothing()
        .returning();
      if (!inserted) {
        const [existing] = await db.select().from(journalComments).where(eq(journalComments.id, id));
        if (!existing || existing.entryId !== entryId || existing.authorId !== userId) throw conflict('A comment with that id already exists');
      } else {
        await announce(row.tripId, userId, row, origin);
      }
      return one(row, userId);
    },

    /** The comment's author or a trip owner. */
    async removeComment(commentId: string, userId: string, origin?: string) {
      const [comment] = await db
        .select()
        .from(journalComments)
        .where(and(eq(journalComments.id, commentId), isNull(journalComments.deletedAt)));
      if (!comment) throw notFound('That comment no longer exists');
      const { row, role } = await loadReadable(comment.entryId, userId);
      if (comment.authorId !== userId && role !== 'owner') throw forbidden('Only the person who wrote this, or a trip owner, can delete it');
      await db.update(journalComments).set({ deletedAt: new Date() }).where(eq(journalComments.id, commentId));
      await announce(row.tripId, userId, row, origin);
    },

    /**
     * "Save to journal" on a chat message or poll: a quote entry on the day it
     * was said (on the trip's clock), linking back to it. Saving it again
     * gives back the same quote.
     */
    async saveMessage(messageId: string, userId: string, input: SaveToJournal, origin?: string) {
      const [message] = await db
        .select()
        .from(messages)
        .where(and(eq(messages.id, messageId), isNull(messages.deletedAt)));
      if (!message) throw notFound('That message no longer exists');
      await requireTripRole(db, message.tripId, userId, 'viewer');
      if (message.kind === 'system' || !message.body.trim()) throw badRequest('Only messages with words can be saved as a quote');
      const trip = await tripRow(message.tripId);
      const date = wallClock(message.createdAt.toISOString(), trip.timezone ?? 'UTC').date;

      const [inserted] = await db
        .insert(journalEntries)
        .values({
          id: newId(),
          tripId: message.tripId,
          authorId: userId,
          date,
          kind: 'quote',
          body: message.body.slice(0, 10_000),
          visibility: input.visibility,
          sourceMessageId: messageId,
        })
        .onConflictDoNothing()
        .returning();
      if (!inserted) {
        const [existing] = await db
          .select()
          .from(journalEntries)
          .where(and(eq(journalEntries.sourceMessageId, messageId), eq(journalEntries.authorId, userId)));
        // Saved before and since deleted: bring it back.
        if (existing!.deletedAt) {
          const [restored] = await db
            .update(journalEntries)
            .set({ deletedAt: null, visibility: input.visibility, version: sql`${journalEntries.version} + 1` })
            .where(eq(journalEntries.id, existing!.id))
            .returning();
          if (restored!.visibility === 'group') await announce(restored!.tripId, userId, restored!, origin);
          return { entry: await one(restored!, userId), created: true };
        }
        return { entry: await one(existing!, userId), created: false };
      }
      await db.insert(changeLog).values({ tripId: inserted.tripId, entity: 'journal_entry', entityId: inserted.id, op: 'upsert', changedBy: userId });
      if (inserted.visibility === 'group') await announce(inserted.tripId, userId, inserted, origin);
      return { entry: await one(inserted, userId), created: true };
    },

    /**
     * The trip's story. Once the trip is over it's worked out once and kept
     * until something on the trip changes; it never includes private entries,
     * so it's the same for every member.
     */
    async recap(tripId: string, userId: string): Promise<TripRecap> {
      await requireTripRole(db, tripId, userId, 'viewer');
      const trip = await tripRow(tripId);
      const today = wallClock(new Date().toISOString(), trip.timezone ?? 'UTC').date;
      const final = tripOver(trip, today);
      let data: RecapData;
      if (final) {
        const stamp = await recapStamp(tripId);
        const [cached] = await db.select().from(journalRecaps).where(eq(journalRecaps.tripId, tripId));
        if (cached && cached.stamp === stamp) {
          data = cached.data as RecapData;
        } else {
          data = await computeRecap(tripId);
          await db
            .insert(journalRecaps)
            .values({ tripId, stamp, data })
            .onConflictDoUpdate({ target: journalRecaps.tripId, set: { stamp, data, computedAt: new Date() } });
        }
      } else {
        data = await computeRecap(tripId);
      }

      const members = await db
        .select({ userId: users.id, displayName: users.displayName })
        .from(tripMembers)
        .innerJoin(users, eq(users.id, tripMembers.userId))
        .where(eq(tripMembers.tripId, tripId))
        .orderBy(asc(tripMembers.joinedAt));
      const photoIds = [...data.stats.topPhotoIds, ...data.days.flatMap((d) => d.topPhotoIds), ...data.groupPhotoIds];
      const [cover] = trip.coverMediaId
        ? await db.select({ key: photos.storageKey }).from(photos).where(and(eq(photos.id, trip.coverMediaId), isNull(photos.deletedAt)))
        : [];
      return {
        ...data,
        tripId,
        name: trip.name,
        startDate: trip.startDate,
        endDate: trip.endDate,
        coverColor: trip.coverColor,
        coverUrl: cover && storage ? await storage.downloadUrl(cover.key, 'cover.jpg', ttl) : null,
        currency: trip.baseCurrency,
        members,
        photos: await signPhotos(tripId, photoIds, userId),
        final,
      };
    },

    /** "1 year ago: Goa with the gang": my past trips with a day on today's date. `today` is the phone's date. */
    async memories(userId: string, today: string): Promise<{ memories: Memory[] }> {
      const rows = await db
        .select({
          tripId: trips.id,
          tripName: trips.name,
          startDate: trips.startDate,
          endDate: trips.endDate,
          coverColor: trips.coverColor,
          coverKey: photos.storageKey,
        })
        .from(tripMembers)
        .innerJoin(trips, eq(trips.id, tripMembers.tripId))
        .leftJoin(photos, and(eq(photos.id, trips.coverMediaId), isNull(photos.deletedAt)))
        .where(
          and(
            eq(tripMembers.userId, userId),
            isNull(tripMembers.leftAt),
            isNull(trips.deletedAt),
            isNotNull(trips.startDate),
            sql`${trips.startDate} < ${today}::date`,
          ),
        );
      const memories: Memory[] = [];
      for (const r of rows) {
        const match = memoryFor(r, today);
        if (!match) continue;
        memories.push({
          tripId: r.tripId,
          tripName: r.tripName,
          ...match,
          coverColor: r.coverColor,
          coverUrl: r.coverKey && storage ? await storage.downloadUrl(r.coverKey, 'cover.jpg', ttl) : null,
        });
      }
      return { memories: memories.sort((a, b) => a.yearsAgo - b.yearsAgo) };
    },
  };
};
