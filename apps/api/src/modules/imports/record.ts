import { eq } from 'drizzle-orm';
import { bookingImports, changeLog, type Db } from '@tagalong/db';
import {
  BookingCandidate,
  newId,
  type BookingImport,
  type BookingType,
  type ImportSource,
  type ImportStatus,
} from '@tagalong/shared';
import type { Redis } from 'ioredis';
import { publishTripEvent } from '../../lib/events';
import type { Candidate } from '../../lib/booking-import';
import { postSystemMessage } from '../chat/channel';

type Row = typeof bookingImports.$inferSelect;

export const toImport = (r: Row): BookingImport => ({
  id: r.id,
  tripId: r.tripId,
  source: r.source as ImportSource,
  createdBy: r.createdBy,
  fromAddress: r.fromAddress,
  subject: r.subject,
  receivedAt: r.receivedAt.toISOString(),
  status: r.status as ImportStatus,
  candidates: BookingCandidate.array().parse(r.candidates),
  documentId: r.documentId,
  createdAt: r.createdAt.toISOString(),
});

/** Pending while anything is still open; then added if anything was, else dismissed. */
export const statusOf = (candidates: BookingCandidate[]): ImportStatus =>
  candidates.some((c) => c.state === 'open') ? 'pending' : candidates.some((c) => c.state === 'added') ? 'added' : 'dismissed';

const WORDS: Record<BookingType, string> = {
  flight: 'a flight',
  stay: 'a stay',
  train: 'a train',
  ticket: 'tickets',
  car: 'a car booking',
  restaurant: 'a table booking',
};

/** "a flight", "2 flights", "3 bookings". */
export const describeFound = (candidates: Pick<Candidate, 'booking'>[]) => {
  const types = [...new Set(candidates.map((c) => c.booking.type))];
  if (candidates.length === 1) return WORDS[types[0]!];
  return types.length === 1 && types[0] === 'flight' ? `${candidates.length} flights` : `${candidates.length} bookings`;
};

/**
 * Saves what the parser found as an import to review, announces it, and for
 * a forwarded email posts a card in chat. Never makes a booking by itself.
 * The same email (Message-ID) or retried id comes back as the existing import.
 */
export const recordImport = async (
  db: Db,
  redis: Redis,
  input: {
    id?: string;
    tripId: string;
    source: ImportSource;
    createdBy: string;
    fromAddress?: string | null;
    subject?: string | null;
    receivedAt?: Date;
    candidates: Candidate[];
    documentId?: string | null;
    messageId?: string | null;
  },
  origin?: string,
): Promise<{ import: BookingImport; created: boolean }> => {
  const id = input.id ?? newId();
  const candidates = input.candidates.map((c) => BookingCandidate.parse({ ...c, state: 'open', bookingId: null }));
  const result = await db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(bookingImports)
      .values({
        id,
        tripId: input.tripId,
        source: input.source,
        createdBy: input.createdBy,
        fromAddress: input.fromAddress ?? null,
        subject: input.subject?.slice(0, 300) ?? null,
        receivedAt: input.receivedAt ?? new Date(),
        // Nothing found: nothing to review.
        status: candidates.length > 0 ? 'pending' : 'dismissed',
        candidates,
        documentId: input.documentId ?? null,
        messageId: input.messageId ?? null,
      })
      .onConflictDoNothing()
      .returning();
    if (!inserted) {
      const [existing] = input.messageId
        ? await tx.select().from(bookingImports).where(eq(bookingImports.messageId, input.messageId))
        : await tx.select().from(bookingImports).where(eq(bookingImports.id, id));
      if (!existing || existing.tripId !== input.tripId) throw new Error('An import with that id already exists');
      return { row: existing, created: false, card: null };
    }
    await tx.insert(changeLog).values({
      tripId: input.tripId,
      entity: 'booking_import',
      entityId: id,
      op: 'upsert',
      changedBy: input.createdBy,
    });
    const card =
      input.source === 'email' && candidates.length > 0
        ? await postSystemMessage(
            tx,
            input.tripId,
            input.createdBy,
            (name) => `Found ${describeFound(candidates)} in ${name}’s email. Review it in Tickets & files.`,
            { event: 'import_created', importId: id },
          )
        : null;
    return { row: inserted, created: true, card };
  });

  const found = toImport(result.row);
  if (result.created) {
    await publishTripEvent(redis, {
      type: 'import.created',
      tripId: input.tripId,
      entityId: id,
      actorId: input.createdBy,
      payload: found,
      originClientId: origin,
    });
  }
  if (result.card) {
    await publishTripEvent(redis, {
      type: 'message.created',
      tripId: input.tripId,
      entityId: result.card.id,
      actorId: input.createdBy,
      payload: result.card,
    });
  }
  return { import: found, created: result.created };
};
