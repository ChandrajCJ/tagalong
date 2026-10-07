import { and, asc, eq, gte, isNull, sql } from 'drizzle-orm';
import { bookings, changeLog, documents, items, type Db, type Tx } from '@tagalong/db';
import {
  CreateBookingInput,
  newId,
  parseBookingDetails,
  UpdateBookingInput,
  type Booking,
  type BookingType,
  type NextUp,
} from '@tagalong/shared';
import type { Redis } from 'ioredis';
import type { z } from 'zod';
import { requireTripRole } from '../../lib/access';
import { badRequest, conflict, notFound } from '../../lib/errors';
import { publishTripEvent } from '../../lib/events';
import { postSystemMessage } from '../chat/channel';

type CreateBooking = z.output<typeof CreateBookingInput>;
type UpdateBooking = z.output<typeof UpdateBookingInput>;
type Row = typeof bookings.$inferSelect;

const TYPE_WORDS: Record<BookingType, string> = {
  flight: 'a flight',
  stay: 'a stay',
  train: 'a train',
  ticket: 'tickets',
  car: 'a car',
  restaurant: 'a table',
};

export const toBooking = (r: Row): Booking => ({
  id: r.id,
  tripId: r.tripId,
  itemId: r.itemId,
  documentId: r.documentId,
  type: r.type as BookingType,
  provider: r.provider,
  reference: r.reference,
  startsAt: r.startsAt?.toISOString() ?? null,
  endsAt: r.endsAt?.toISOString() ?? null,
  timezone: r.timezone,
  details: (r.details as Record<string, unknown>) ?? {},
  costMinor: r.costMinor,
  costCurrency: r.costCurrency,
  createdBy: r.createdBy,
  version: r.version,
  updatedAt: r.updatedAt.toISOString(),
});

const instant = (iso: string | null | undefined) =>
  iso === undefined ? undefined : iso === null ? null : new Date(iso);

export const createBookingsService = (db: Db, redis: Redis) => {
  /**
   * A booking may only point at a plan item and a document from its own trip.
   * Without this, someone could attach another trip's boarding pass by id.
   */
  const checkLinks = async (
    tx: Db | Tx,
    tripId: string,
    links: { itemId?: string | null; documentId?: string | null },
  ) => {
    if (links.itemId) {
      const [item] = await tx
        .select({ tripId: items.tripId })
        .from(items)
        .where(and(eq(items.id, links.itemId), isNull(items.deletedAt)));
      if (item?.tripId !== tripId) throw badRequest('That plan item isn’t on this trip');
    }
    if (links.documentId) {
      const [doc] = await tx
        .select({ tripId: documents.tripId, status: documents.status })
        .from(documents)
        .where(and(eq(documents.id, links.documentId), isNull(documents.deletedAt)));
      if (doc?.tripId !== tripId || doc.status !== 'ready') {
        throw badRequest('That file isn’t on this trip');
      }
    }
  };

  const loadLive = async (bookingId: string) => {
    const [row] = await db
      .select()
      .from(bookings)
      .where(and(eq(bookings.id, bookingId), isNull(bookings.deletedAt)));
    if (!row) throw notFound('That booking no longer exists');
    return row;
  };

  const announce = (booking: Booking, actorId: string, origin?: string) =>
    publishTripEvent(redis, {
      type: 'booking.upserted',
      tripId: booking.tripId,
      entityId: booking.id,
      actorId,
      version: booking.version,
      payload: booking,
      originClientId: origin,
    });

  return {
    async list(tripId: string, userId: string): Promise<Booking[]> {
      await requireTripRole(db, tripId, userId, 'viewer');
      const rows = await db
        .select()
        .from(bookings)
        .where(and(eq(bookings.tripId, tripId), isNull(bookings.deletedAt)))
        .orderBy(sql`${bookings.startsAt} asc nulls last`, asc(bookings.createdAt));
      return rows.map(toBooking);
    },

    /** Retrying with the same client-generated id returns the same booking. */
    async create(tripId: string, userId: string, input: CreateBooking, origin?: string) {
      await requireTripRole(db, tripId, userId, 'editor');
      const id = input.id ?? newId();

      const result = await db.transaction(async (tx) => {
        await checkLinks(tx, tripId, input);
        const [inserted] = await tx
          .insert(bookings)
          .values({
            id,
            tripId,
            itemId: input.itemId ?? null,
            documentId: input.documentId ?? null,
            type: input.type,
            provider: input.provider ?? null,
            reference: input.reference ?? null,
            startsAt: instant(input.startsAt) ?? null,
            endsAt: instant(input.endsAt) ?? null,
            timezone: input.timezone,
            details: input.details,
            costMinor: input.costMinor ?? null,
            costCurrency: input.costCurrency ?? null,
            createdBy: userId,
          })
          .onConflictDoNothing()
          .returning();

        if (!inserted) {
          const [existing] = await tx.select().from(bookings).where(eq(bookings.id, id));
          if (!existing || existing.tripId !== tripId || existing.createdBy !== userId) {
            throw conflict('A booking with that id already exists');
          }
          return { booking: toBooking(existing), created: false, card: null };
        }

        await tx
          .insert(changeLog)
          .values({ tripId, entity: 'booking', entityId: id, op: 'upsert', changedBy: userId });
        const card = await postSystemMessage(
          tx,
          tripId,
          userId,
          (name) =>
            `${name} added ${TYPE_WORDS[input.type]}${input.provider ? ` with ${input.provider}` : ''}`,
          { event: 'booking_added', bookingId: id, itemId: input.itemId ?? null },
        );
        return { booking: toBooking(inserted), created: true, card };
      });

      if (result.created) await announce(result.booking, userId, origin);
      if (result.card) {
        await publishTripEvent(redis, {
          type: 'message.created',
          tripId,
          entityId: result.card.id,
          actorId: userId,
          payload: result.card,
        });
      }
      return { booking: result.booking, created: result.created };
    },

    /** Saves only if `version` still matches, like every other shared record. */
    async update(bookingId: string, userId: string, input: UpdateBooking, origin?: string) {
      const current = await loadLive(bookingId);
      await requireTripRole(db, current.tripId, userId, 'editor');
      const { version, ...fields } = input;

      // Changing the type or the details means checking them together.
      const type = (fields.type ?? current.type) as BookingType;
      if (fields.type !== undefined || fields.details !== undefined) {
        const details = parseBookingDetails(type, fields.details ?? current.details);
        if (!details.success) throw badRequest('Those details don’t fit this kind of booking');
      }
      // And a new end must still come after the start, even if only one changed.
      const startsAt = fields.startsAt !== undefined ? fields.startsAt : current.startsAt?.toISOString();
      const endsAt = fields.endsAt !== undefined ? fields.endsAt : current.endsAt?.toISOString();
      if (startsAt && endsAt && new Date(endsAt) < new Date(startsAt)) {
        throw badRequest('Ends before it starts');
      }

      const updated = await db.transaction(async (tx) => {
        await checkLinks(tx, current.tripId, fields);
        const changes: Partial<typeof bookings.$inferInsert> = {
          ...Object.fromEntries(
            Object.entries(fields).filter(
              ([key, v]) => v !== undefined && key !== 'startsAt' && key !== 'endsAt',
            ),
          ),
          ...(fields.startsAt !== undefined ? { startsAt: instant(fields.startsAt) } : {}),
          ...(fields.endsAt !== undefined ? { endsAt: instant(fields.endsAt) } : {}),
        };
        const [row] = await tx
          .update(bookings)
          .set({ ...changes, version: sql`${bookings.version} + 1` })
          .where(
            and(eq(bookings.id, bookingId), eq(bookings.version, version), isNull(bookings.deletedAt)),
          )
          .returning();
        if (!row) return null;
        await tx.insert(changeLog).values({
          tripId: row.tripId,
          entity: 'booking',
          entityId: bookingId,
          op: 'upsert',
          changedBy: userId,
        });
        return row;
      });

      if (!updated) {
        const latest = await loadLive(bookingId);
        throw conflict('Someone changed this while you were editing. Showing the latest version.', {
          current: toBooking(latest),
        });
      }
      const booking = toBooking(updated);
      await announce(booking, userId, origin);
      return booking;
    },

    async remove(bookingId: string, userId: string, origin?: string) {
      const current = await loadLive(bookingId);
      await requireTripRole(db, current.tripId, userId, 'editor');
      const deleted = await db.transaction(async (tx) => {
        const [row] = await tx
          .update(bookings)
          .set({ deletedAt: new Date(), version: sql`${bookings.version} + 1` })
          .where(and(eq(bookings.id, bookingId), isNull(bookings.deletedAt)))
          .returning({ version: bookings.version });
        if (!row) return null;
        await tx.insert(changeLog).values({
          tripId: current.tripId,
          entity: 'booking',
          entityId: bookingId,
          op: 'delete',
          changedBy: userId,
        });
        return row;
      });
      if (!deleted) return;

      await publishTripEvent(redis, {
        type: 'booking.deleted',
        tripId: current.tripId,
        entityId: bookingId,
        actorId: userId,
        version: deleted.version,
        originClientId: origin,
      });
    },

    /**
     * The next booking that hasn't started, for the overview's "Next up". The
     * plan item's title comes along when there is one that still exists.
     */
    async nextUp(tripId: string, userId: string, now = new Date()): Promise<NextUp> {
      await requireTripRole(db, tripId, userId, 'viewer');
      const [row] = await db
        .select({ booking: bookings, itemTitle: items.title })
        .from(bookings)
        .leftJoin(items, and(eq(items.id, bookings.itemId), isNull(items.deletedAt)))
        .where(
          and(
            eq(bookings.tripId, tripId),
            isNull(bookings.deletedAt),
            gte(bookings.startsAt, now),
          ),
        )
        .orderBy(asc(bookings.startsAt))
        .limit(1);
      if (!row) return { booking: null, itemTitle: null };
      const booking = toBooking(row.booking);
      // A booking whose plan item was deleted shouldn't link to a dead screen.
      return {
        booking: row.itemTitle === null ? { ...booking, itemId: null } : booking,
        itemTitle: row.itemTitle,
      };
    },
  };
};
