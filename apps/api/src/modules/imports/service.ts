import { randomBytes } from 'node:crypto';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { bookingImports, changeLog, documents, trips, type Db } from '@tagalong/db';
import {
  AddImportInput,
  CreateImportInput,
  DismissImportInput,
  newId,
  planItemFor,
  type BookingCandidate,
  type BookingImport,
} from '@tagalong/shared';
import type { Redis } from 'ioredis';
import type { z } from 'zod';
import { findBookings, pdfText } from '../../lib/booking-import';
import { requireTripRole } from '../../lib/access';
import { badRequest, conflict, notFound } from '../../lib/errors';
import { publishTripEvent } from '../../lib/events';
import type { Storage } from '../../lib/storage';
import { createBookingsService } from '../bookings/service';
import { createItineraryService } from '../itinerary/service';
import { recordImport, statusOf, toImport } from './record';

type CreateImport = z.output<typeof CreateImportInput>;
type AddImport = z.output<typeof AddImportInput>;
type DismissImport = z.output<typeof DismissImportInput>;

/** A fresh "+code" for a trip's forwarding address: 10 letters and digits, hard to guess. */
export const newInboxCode = () => randomBytes(8).toString('base64url').replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 10).padEnd(10, '0');

/** tagalong.inbox@gmail.com + "k3x9…" → tagalong.inbox+k3x9…@gmail.com */
export const inboxAddress = (address: string, code: string) => {
  const [local, domain] = address.split('@');
  return `${local!.split('+')[0]}+${code}@${domain}`;
};

export const createImportsService = (db: Db, redis: Redis, storage: Storage, importAddress: string | undefined) => {
  const bookings = createBookingsService(db, redis);
  const itinerary = createItineraryService(db, redis);

  const timezoneOf = async (tripId: string) =>
    (await db.select({ timezone: trips.timezone }).from(trips).where(eq(trips.id, tripId)))[0]?.timezone ?? null;

  const loadImport = async (importId: string) => {
    const [row] = await db.select().from(bookingImports).where(eq(bookingImports.id, importId));
    if (!row) throw notFound('That import no longer exists');
    return row;
  };

  const announce = (found: BookingImport, actorId: string, origin?: string) =>
    publishTripEvent(redis, {
      type: 'import.updated',
      tripId: found.tripId,
      entityId: found.id,
      actorId,
      payload: found,
      originClientId: origin,
    });

  /**
   * Changes one candidate (or all open ones) under a row lock, so two people
   * can't both add the same flight. `change` returns the new candidate, or
   * null to leave it.
   */
  const updateCandidates = async (
    importId: string,
    userId: string,
    pick: (c: BookingCandidate, index: number) => boolean,
    change: (c: BookingCandidate) => BookingCandidate,
  ) =>
    db.transaction(async (tx) => {
      const [row] = await tx.select().from(bookingImports).where(eq(bookingImports.id, importId)).for('update');
      if (!row) throw notFound('That import no longer exists');
      const current = toImport(row);
      const candidates = current.candidates.map((c, i) => (pick(c, i) ? change(c) : c));
      const [updated] = await tx
        .update(bookingImports)
        .set({ candidates, status: statusOf(candidates), updatedAt: new Date() })
        .where(eq(bookingImports.id, importId))
        .returning();
      await tx
        .insert(changeLog)
        .values({ tripId: row.tripId, entity: 'booking_import', entityId: importId, op: 'upsert', changedBy: userId });
      return toImport(updated!);
    });

  return {
    /** Everything found in emails for this trip, the ones still to review first. */
    async list(tripId: string, userId: string): Promise<BookingImport[]> {
      await requireTripRole(db, tripId, userId, 'editor');
      const rows = await db
        .select()
        .from(bookingImports)
        .where(eq(bookingImports.tripId, tripId))
        .orderBy(sql`${bookingImports.status} = 'pending' desc`, desc(bookingImports.createdAt))
        .limit(50);
      return rows.map(toImport);
    },

    /** Reads a pasted email, or a PDF or text file already in Docs, straight away. */
    async create(tripId: string, userId: string, input: CreateImport, origin?: string) {
      await requireTripRole(db, tripId, userId, 'editor');
      const timezone = await timezoneOf(tripId);
      if (input.documentId) {
        const [doc] = await db
          .select()
          .from(documents)
          .where(and(eq(documents.id, input.documentId), eq(documents.tripId, tripId), isNull(documents.deletedAt)));
        if (!doc || doc.status !== 'ready') throw badRequest('That file isn’t in this trip’s Docs');
        let text: string | null;
        if (doc.contentType === 'application/pdf') {
          const bytes = await storage.read(doc.storageKey);
          text = bytes ? await pdfText(bytes) : null;
        } else if (doc.contentType === 'text/plain') {
          text = (await storage.read(doc.storageKey))?.toString('utf8') ?? null;
        } else {
          throw badRequest('Only PDFs and text files can be read. For a screenshot, paste the email text instead.', 'unreadable');
        }
        return recordImport(
          db,
          redis,
          {
            id: input.id,
            tripId,
            source: 'document',
            createdBy: userId,
            subject: doc.name,
            documentId: doc.id,
            candidates: text ? findBookings({ text, timezone, receivedAt: doc.createdAt }) : [],
          },
          origin,
        );
      }
      return recordImport(
        db,
        redis,
        { id: input.id, tripId, source: 'paste', createdBy: userId, candidates: findBookings({ text: input.text, timezone }) },
        origin,
      );
    },

    /**
     * Adds one candidate as a booking, with the person's corrections, and by
     * default puts it in the plan too. The candidate is claimed first, under a
     * lock, so a second tap (or a second person) gets a 409 instead of a copy.
     */
    async add(importId: string, userId: string, input: AddImport, origin?: string) {
      const row = await loadImport(importId);
      await requireTripRole(db, row.tripId, userId, 'editor');
      const existing = toImport(row).candidates[input.candidateIndex];
      if (!existing) throw badRequest('That booking isn’t in this import');
      const bookingId = input.booking.id ?? newId();

      let claimed = false;
      const claim = await updateCandidates(
        importId,
        userId,
        (c, i) => i === input.candidateIndex && c.state === 'open' && (claimed = true),
        (c) => ({ ...c, state: 'added', bookingId }),
      );
      if (!claimed) {
        const already = claim.candidates[input.candidateIndex];
        throw conflict(
          already?.state === 'added' ? 'Someone already added this booking.' : 'Someone said this one isn’t a booking.',
          { current: claim },
        );
      }

      try {
        let itemId = input.booking.itemId ?? null;
        if (!itemId && input.addToPlan) {
          const fields = planItemFor(input.booking);
          const { item } = await itinerary.create(row.tripId, userId, { ...fields, costCurrency: null, costEstimateMinor: null }, origin);
          itemId = item.id;
        }
        await bookings.create(
          row.tripId,
          userId,
          { ...input.booking, id: bookingId, itemId, documentId: input.booking.documentId ?? row.documentId },
          origin,
        );
        await announce(claim, userId, origin);
        return { import: claim, bookingId, itemId };
      } catch (e) {
        // Give the candidate back, so it can be tried again.
        const reopened = await updateCandidates(
          importId,
          userId,
          (c, i) => i === input.candidateIndex && c.bookingId === bookingId,
          (c) => ({ ...c, state: 'open', bookingId: null }),
        );
        await announce(reopened, userId, origin);
        throw e;
      }
    },

    /** "Not this": skips one candidate, or every open one when no index is given. */
    async dismiss(importId: string, userId: string, input: DismissImport, origin?: string) {
      const row = await loadImport(importId);
      await requireTripRole(db, row.tripId, userId, 'editor');
      const updated = await updateCandidates(
        importId,
        userId,
        (c, i) => c.state === 'open' && (input.candidateIndex === undefined || i === input.candidateIndex),
        (c) => ({ ...c, state: 'skipped' }),
      );
      await announce(updated, userId, origin);
      return updated;
    },

    /** The trip's forwarding address, made the first time someone asks. Null when there's no inbox. */
    async inbox(tripId: string, userId: string) {
      await requireTripRole(db, tripId, userId, 'editor');
      if (!importAddress) return { address: null };
      const [trip] = await db.select({ code: trips.inboxCode }).from(trips).where(eq(trips.id, tripId));
      let code = trip?.code ?? null;
      if (!code) {
        // Two people asking at once must end up with the same code.
        await db.update(trips).set({ inboxCode: newInboxCode() }).where(and(eq(trips.id, tripId), isNull(trips.inboxCode)));
        code = (await db.select({ code: trips.inboxCode }).from(trips).where(eq(trips.id, tripId)))[0]!.code;
      }
      return { address: inboxAddress(importAddress, code!) };
    },

    /** A new address, for when the old one got shared too widely. Owners only. */
    async rotateInbox(tripId: string, userId: string) {
      await requireTripRole(db, tripId, userId, 'owner');
      if (!importAddress) return { address: null };
      const code = newInboxCode();
      await db.update(trips).set({ inboxCode: code }).where(eq(trips.id, tripId));
      return { address: inboxAddress(importAddress, code) };
    },
  };
};
