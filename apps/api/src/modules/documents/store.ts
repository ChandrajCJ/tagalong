import { eq } from 'drizzle-orm';
import { changeLog, documents, users, type Db } from '@tagalong/db';
import { newId, type DocumentKind } from '@tagalong/shared';
import type { Redis } from 'ioredis';
import { publishTripEvent } from '../../lib/events';
import type { Storage } from '../../lib/storage';
import { safeName, toDocument } from './service';

/**
 * Saves a file the server already has (a PDF attached to a forwarded email)
 * straight into the trip's Docs, ready to open. Uploads from the app go
 * through a signed link instead.
 */
export const storeDocument = async (
  db: Db,
  redis: Redis,
  storage: Storage,
  input: { tripId: string; uploadedBy: string; name: string; contentType: string; body: Buffer; kind: DocumentKind },
) => {
  const id = newId();
  const storageKey = `trips/${input.tripId}/documents/${id}/${safeName(input.name)}`;
  await storage.write(storageKey, input.body, input.contentType);
  const row = await db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(documents)
      .values({
        id,
        tripId: input.tripId,
        uploadedBy: input.uploadedBy,
        kind: input.kind,
        name: input.name.slice(0, 200),
        storageKey,
        contentType: input.contentType,
        sizeBytes: input.body.length,
        status: 'ready',
      })
      .returning();
    await tx
      .insert(changeLog)
      .values({ tripId: input.tripId, entity: 'document', entityId: id, op: 'upsert', changedBy: input.uploadedBy });
    return inserted!;
  });
  const [uploader] = await db.select({ name: users.displayName }).from(users).where(eq(users.id, input.uploadedBy));
  const document = toDocument(row, uploader?.name ?? null);
  await publishTripEvent(redis, {
    type: 'document.upserted',
    tripId: input.tripId,
    entityId: id,
    actorId: input.uploadedBy,
    version: document.version,
    payload: document,
  });
  return document;
};
