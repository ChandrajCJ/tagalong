import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { changeLog, documents, users, type Db } from '@tagalong/db';
import {
  CreateDocumentInput,
  newId,
  UpdateDocumentInput,
  type TripDocument,
} from '@tagalong/shared';
import type { Redis } from 'ioredis';
import type { z } from 'zod';
import type { Env } from '../../env';
import { requireTripRole } from '../../lib/access';
import { badRequest, conflict, notFound } from '../../lib/errors';
import { publishTripEvent } from '../../lib/events';
import type { Storage } from '../../lib/storage';
import { postSystemMessage } from '../chat/channel';

type CreateDocument = z.output<typeof CreateDocumentInput>;
type UpdateDocument = z.output<typeof UpdateDocumentInput>;
type Row = typeof documents.$inferSelect;

/** Keeps the extension, drops anything that could escape the key's folder. */
const safeName = (name: string) => name.replace(/[^\w.\- ]+/g, '_').slice(0, 200);

const toDocument = (r: Row, uploaderName: string | null): TripDocument => ({
  id: r.id,
  tripId: r.tripId,
  uploadedBy: r.uploadedBy,
  uploaderName,
  kind: r.kind as TripDocument['kind'],
  name: r.name,
  contentType: r.contentType,
  sizeBytes: r.sizeBytes,
  status: r.status as TripDocument['status'],
  hasThumbnail: r.thumbnailKey !== null,
  version: r.version,
  createdAt: r.createdAt.toISOString(),
});

export const createDocumentsService = (
  db: Db,
  redis: Redis,
  storage: Storage,
  env: Env,
) => {
  const ttl = env.S3_URL_TTL_SEC;

  const nameOf = async (userId: string) => {
    const [user] = await db
      .select({ name: users.displayName })
      .from(users)
      .where(eq(users.id, userId));
    return user?.name ?? null;
  };

  const loadLive = async (documentId: string) => {
    const [row] = await db
      .select()
      .from(documents)
      .where(and(eq(documents.id, documentId), isNull(documents.deletedAt)));
    if (!row) throw notFound('That file is no longer here');
    return row;
  };

  const announce = async (row: Row, actorId: string, origin?: string) =>
    publishTripEvent(redis, {
      type: 'document.upserted',
      tripId: row.tripId,
      entityId: row.id,
      actorId,
      version: row.version,
      payload: toDocument(row, await nameOf(row.uploadedBy)),
      originClientId: origin,
    });

  return {
    /** Only files that finished uploading. A pending row is nobody else's business. */
    async list(tripId: string, userId: string): Promise<TripDocument[]> {
      await requireTripRole(db, tripId, userId, 'viewer');
      const rows = await db
        .select({ document: documents, uploaderName: users.displayName })
        .from(documents)
        .innerJoin(users, eq(users.id, documents.uploadedBy))
        .where(
          and(
            eq(documents.tripId, tripId),
            isNull(documents.deletedAt),
            // Your own unfinished uploads stay visible to you, so a retry has something to attach to.
            sql`(${documents.status} = 'ready' or ${documents.uploadedBy} = ${userId})`,
          ),
        )
        .orderBy(desc(documents.createdAt));
      return rows.map((r) => toDocument(r.document, r.uploaderName));
    },

    /**
     * Step one of an upload: we record the file and hand back a link the phone
     * PUTs the bytes to. Nothing large ever passes through the API.
     */
    async start(tripId: string, userId: string, input: CreateDocument) {
      await requireTripRole(db, tripId, userId, 'editor');
      const id = input.id ?? newId();

      const [existing] = await db.select().from(documents).where(eq(documents.id, id));
      if (existing) {
        if (existing.tripId !== tripId || existing.uploadedBy !== userId) {
          throw conflict('A file with that id already exists');
        }
        // A retry of the same upload: hand back a fresh link for the same object.
        return {
          document: toDocument(existing, await nameOf(userId)),
          uploadUrl: await storage.uploadUrl(existing.storageKey, existing.contentType, ttl),
          expiresIn: ttl,
        };
      }

      const storageKey = `trips/${tripId}/documents/${id}/${safeName(input.name)}`;
      const [row] = await db
        .insert(documents)
        .values({
          id,
          tripId,
          uploadedBy: userId,
          kind: input.kind,
          name: input.name,
          storageKey,
          contentType: input.contentType,
          sizeBytes: input.sizeBytes,
          status: 'pending',
        })
        .returning();

      return {
        document: toDocument(row!, await nameOf(userId)),
        uploadUrl: await storage.uploadUrl(storageKey, input.contentType, ttl),
        expiresIn: ttl,
      };
    },

    /**
     * Step two: the phone says it's done. We check the object really arrived
     * before anyone else sees the file.
     */
    async complete(documentId: string, userId: string, origin?: string) {
      const row = await loadLive(documentId);
      await requireTripRole(db, row.tripId, userId, 'editor');
      if (row.uploadedBy !== userId) throw notFound('That file is no longer here');
      if (row.status === 'ready') return toDocument(row, await nameOf(row.uploadedBy));

      const size = await storage.sizeOf(row.storageKey);
      if (size === null) throw badRequest('The upload didn’t arrive. Try again.', 'upload_missing');
      // What arrived must be what the phone said it was sending (see photos/service.ts).
      if (row.sizeBytes !== null && size !== row.sizeBytes) {
        throw badRequest('The file only partly arrived. Try again.', 'upload_incomplete');
      }

      const ready = await db.transaction(async (tx) => {
        const [updated] = await tx
          .update(documents)
          .set({ status: 'ready', sizeBytes: size, version: sql`${documents.version} + 1` })
          .where(eq(documents.id, documentId))
          .returning();
        await tx.insert(changeLog).values({
          tripId: row.tripId,
          entity: 'document',
          entityId: documentId,
          op: 'upsert',
          changedBy: userId,
        });
        const card = await postSystemMessage(
          tx,
          row.tripId,
          userId,
          (name) => `${name} added “${row.name}”`,
          { event: 'document_added', documentId },
        );
        return { row: updated!, card };
      });

      await announce(ready.row, userId, origin);
      // No origin: the person who uploaded it should see the card in chat too.
      await publishTripEvent(redis, {
        type: 'message.created',
        tripId: row.tripId,
        entityId: ready.card.id,
        actorId: userId,
        payload: ready.card,
      });
      return toDocument(ready.row, await nameOf(row.uploadedBy));
    },

    /** A link to read the file, good for a few minutes. Storage is never public. */
    async link(documentId: string, userId: string) {
      const row = await loadLive(documentId);
      await requireTripRole(db, row.tripId, userId, 'viewer');
      if (row.status !== 'ready') throw notFound('That file is still uploading');
      return { url: await storage.downloadUrl(row.storageKey, row.name, ttl), expiresIn: ttl };
    },

    /** Renaming or re-tagging, with the same version check as everything else. */
    async update(documentId: string, userId: string, input: UpdateDocument, origin?: string) {
      const current = await loadLive(documentId);
      await requireTripRole(db, current.tripId, userId, 'editor');
      const { version, ...fields } = input;
      const changes = Object.fromEntries(
        Object.entries(fields).filter(([, v]) => v !== undefined),
      ) as Partial<typeof documents.$inferInsert>;

      const [updated] = await db
        .update(documents)
        .set({ ...changes, version: sql`${documents.version} + 1` })
        .where(
          and(
            eq(documents.id, documentId),
            eq(documents.version, version),
            isNull(documents.deletedAt),
          ),
        )
        .returning();

      if (!updated) {
        const latest = await loadLive(documentId);
        throw conflict('Someone changed this while you were editing. Showing the latest version.', {
          current: toDocument(latest, await nameOf(latest.uploadedBy)),
        });
      }
      await announce(updated, userId, origin);
      return toDocument(updated, await nameOf(updated.uploadedBy));
    },

    /** The uploader or a trip owner can remove a file. The bytes go too. */
    async remove(documentId: string, userId: string, origin?: string) {
      const row = await loadLive(documentId);
      const role = await requireTripRole(db, row.tripId, userId, 'editor');
      if (row.uploadedBy !== userId && role !== 'owner') {
        throw notFound('That file is no longer here');
      }

      const [deleted] = await db
        .update(documents)
        .set({ deletedAt: new Date(), version: sql`${documents.version} + 1` })
        .where(and(eq(documents.id, documentId), isNull(documents.deletedAt)))
        .returning({ version: documents.version });
      if (!deleted) return;

      await db.insert(changeLog).values({
        tripId: row.tripId,
        entity: 'document',
        entityId: documentId,
        op: 'delete',
        changedBy: userId,
      });
      // Best effort: a row nobody can see matters more than a stray object.
      await storage.remove(row.storageKey).catch(() => {});

      await publishTripEvent(redis, {
        type: 'document.deleted',
        tripId: row.tripId,
        entityId: documentId,
        actorId: userId,
        version: deleted.version,
        originClientId: origin,
      });
    },
  };
};
