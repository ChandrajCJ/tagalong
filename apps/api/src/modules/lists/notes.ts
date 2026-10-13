import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { changeLog, notes, type Db } from '@tagalong/db';
import { CreateNoteInput, newId, UpdateNoteInput, type TripNote } from '@tagalong/shared';
import type { Redis } from 'ioredis';
import type { z } from 'zod';
import { requireTripRole } from '../../lib/access';
import { conflict, notFound } from '../../lib/errors';
import { publishTripEvent } from '../../lib/events';

type CreateNote = z.output<typeof CreateNoteInput>;
type UpdateNote = z.output<typeof UpdateNoteInput>;
type Row = typeof notes.$inferSelect;

const toNote = (r: Row): TripNote => ({
  id: r.id,
  tripId: r.tripId,
  title: r.title,
  body: r.body,
  pinned: r.pinned,
  updatedBy: r.updatedBy,
  version: r.version,
  updatedAt: r.updatedAt.toISOString(),
});

/**
 * Trip notes: "Emergency numbers", "Wi-Fi codes". No live co-editing: a save
 * carries the version you started from, and a mismatch is a 409 with the
 * other person's copy, so the app can show both and let you pick.
 */
export const createNotesService = (db: Db, redis: Redis) => {
  const loadLive = async (noteId: string) => {
    const [row] = await db
      .select()
      .from(notes)
      .where(and(eq(notes.id, noteId), isNull(notes.deletedAt)));
    if (!row) throw notFound('That note no longer exists');
    return row;
  };

  const announce = (note: TripNote, actorId: string, origin?: string) =>
    publishTripEvent(redis, {
      type: 'note.upserted',
      tripId: note.tripId,
      entityId: note.id,
      actorId,
      version: note.version,
      payload: note,
      originClientId: origin,
    });

  return {
    /** Pinned first, then the most recently changed. */
    async list(tripId: string, userId: string) {
      await requireTripRole(db, tripId, userId, 'viewer');
      const rows = await db
        .select()
        .from(notes)
        .where(and(eq(notes.tripId, tripId), isNull(notes.deletedAt)))
        .orderBy(desc(notes.pinned), desc(notes.updatedAt));
      return rows.map(toNote);
    },

    async create(tripId: string, userId: string, input: CreateNote, origin?: string) {
      await requireTripRole(db, tripId, userId, 'editor');
      const id = input.id ?? newId();
      const result = await db.transaction(async (tx) => {
        const [inserted] = await tx
          .insert(notes)
          .values({ id, tripId, title: input.title, body: input.body, pinned: input.pinned, updatedBy: userId })
          .onConflictDoNothing()
          .returning();
        if (!inserted) {
          const [existing] = await tx.select().from(notes).where(eq(notes.id, id));
          if (!existing || existing.tripId !== tripId) throw conflict('A note with that id already exists');
          return { note: toNote(existing), created: false };
        }
        await tx.insert(changeLog).values({ tripId, entity: 'note', entityId: id, op: 'upsert', changedBy: userId });
        return { note: toNote(inserted), created: true };
      });
      if (result.created) await announce(result.note, userId, origin);
      return result;
    },

    async update(noteId: string, userId: string, input: UpdateNote, origin?: string) {
      const current = await loadLive(noteId);
      await requireTripRole(db, current.tripId, userId, 'editor');
      const { version, ...fields } = input;
      const changes = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));

      const updated = await db.transaction(async (tx) => {
        const [row] = await tx
          .update(notes)
          .set({ ...changes, updatedBy: userId, version: sql`${notes.version} + 1` })
          .where(and(eq(notes.id, noteId), eq(notes.version, version), isNull(notes.deletedAt)))
          .returning();
        if (!row) return null;
        await tx
          .insert(changeLog)
          .values({ tripId: row.tripId, entity: 'note', entityId: noteId, op: 'upsert', changedBy: userId });
        return row;
      });
      if (!updated) {
        const [latest] = await db
          .select()
          .from(notes)
          .where(and(eq(notes.id, noteId), isNull(notes.deletedAt)));
        if (!latest) throw notFound('That note no longer exists');
        throw conflict('Someone changed this note while you were editing.', { current: toNote(latest) });
      }
      const note = toNote(updated);
      await announce(note, userId, origin);
      return note;
    },

    async remove(noteId: string, userId: string, origin?: string) {
      const current = await loadLive(noteId);
      await requireTripRole(db, current.tripId, userId, 'editor');
      const deleted = await db.transaction(async (tx) => {
        const [row] = await tx
          .update(notes)
          .set({ deletedAt: new Date(), version: sql`${notes.version} + 1` })
          .where(and(eq(notes.id, noteId), isNull(notes.deletedAt)))
          .returning({ version: notes.version });
        if (!row) return null;
        await tx
          .insert(changeLog)
          .values({ tripId: current.tripId, entity: 'note', entityId: noteId, op: 'delete', changedBy: userId });
        return row;
      });
      if (!deleted) return;
      await publishTripEvent(redis, {
        type: 'note.deleted',
        tripId: current.tripId,
        entityId: noteId,
        actorId: userId,
        version: deleted.version,
        originClientId: origin,
      });
    },
  };
};
