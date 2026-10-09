import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { changeLog, photos, users, type Db } from '@tagalong/db';
import { CreatePhotoInput, newId, type Photo } from '@tagalong/shared';
import type { Redis } from 'ioredis';
import type { z } from 'zod';
import type { Env } from '../../env';
import { requireTripRole } from '../../lib/access';
import { badRequest, conflict, notFound } from '../../lib/errors';
import { publishTripEvent } from '../../lib/events';
import type { Jobs } from '../../lib/jobs';
import type { Storage } from '../../lib/storage';
import { postSystemMessage } from '../chat/channel';

type CreatePhoto = z.output<typeof CreatePhotoInput>;
type Row = typeof photos.$inferSelect;

/** Postgres's "unique_violation", wherever the driver puts it. */
const isUniqueViolation = (e: unknown): boolean => {
  const err = e as { code?: string; cause?: { code?: string } };
  return err?.code === '23505' || err?.cause?.code === '23505';
};

const EXTENSIONS: Record<Photo['contentType'], string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/** Postgres hands back "2026-06-12 18:30:00"; the app speaks "2026-06-12T18:30:00". */
const isoLocal = (value: string | null) => (value ? value.replace(' ', 'T').slice(0, 19) : null);

export const createPhotosService = (
  db: Db,
  redis: Redis,
  storage: Storage,
  jobs: Jobs,
  env: Env,
) => {
  const ttl = env.S3_URL_TTL_SEC;

  /** Signs fresh links for one viewer. Never stored or broadcast: they expire. */
  const toPhoto = async (r: Row, uploaderName: string | null): Promise<Photo> => {
    const ready = r.status === 'ready';
    const [thumbUrl, url] = await Promise.all([
      ready && r.thumbKey ? storage.downloadUrl(r.thumbKey, `${r.id}.webp`, ttl) : null,
      ready ? storage.downloadUrl(r.storageKey, `${r.id}.${EXTENSIONS[r.contentType as Photo['contentType']]}`, ttl) : null,
    ]);
    return {
      id: r.id,
      tripId: r.tripId,
      uploadedBy: r.uploadedBy,
      uploaderName,
      batchId: r.batchId,
      contentType: r.contentType as Photo['contentType'],
      sizeBytes: r.sizeBytes,
      width: r.width,
      height: r.height,
      takenAt: isoLocal(r.takenAt),
      latitude: r.latitude,
      longitude: r.longitude,
      status: r.status as Photo['status'],
      caption: r.caption,
      version: r.version,
      createdAt: r.createdAt.toISOString(),
      thumbUrl,
      url,
    };
  };

  const loadLive = async (photoId: string) => {
    const [row] = await db
      .select({ photo: photos, uploaderName: users.displayName })
      .from(photos)
      .innerJoin(users, eq(users.id, photos.uploadedBy))
      .where(and(eq(photos.id, photoId), isNull(photos.deletedAt)));
    if (!row) throw notFound('That photo is no longer here');
    return row;
  };

  return {
    /**
     * The album, oldest moment first. Photos still uploading are shown only to
     * the person uploading them.
     */
    async list(tripId: string, userId: string) {
      await requireTripRole(db, tripId, userId, 'viewer');
      const rows = await db
        .select({ photo: photos, uploaderName: users.displayName })
        .from(photos)
        .innerJoin(users, eq(users.id, photos.uploadedBy))
        .where(
          and(
            eq(photos.tripId, tripId),
            isNull(photos.deletedAt),
            sql`(${photos.status} = 'ready' or ${photos.uploadedBy} = ${userId})`,
          ),
        )
        // A photo with no date from the camera sorts by when it was added.
        .orderBy(sql`coalesce(${photos.takenAt}, ${photos.createdAt}) asc`, asc(photos.id));
      return {
        photos: await Promise.all(rows.map((r) => toPhoto(r.photo, r.uploaderName))),
        expiresIn: ttl,
      };
    },

    /** One photo with fresh links, for when the worker announces its thumbnail. */
    async get(photoId: string, userId: string) {
      const { photo, uploaderName } = await loadLive(photoId);
      await requireTripRole(db, photo.tripId, userId, 'viewer');
      if (photo.status !== 'ready' && photo.uploadedBy !== userId) {
        throw notFound('That photo is no longer here');
      }
      return toPhoto(photo, uploaderName);
    },

    /** Step one: record the photo and hand back where to send the bytes. */
    async start(tripId: string, userId: string, input: CreatePhoto) {
      await requireTripRole(db, tripId, userId, 'editor');
      const id = input.id ?? newId();

      const [existing] = await db.select().from(photos).where(eq(photos.id, id));
      if (existing) {
        if (existing.tripId !== tripId || existing.uploadedBy !== userId) {
          throw conflict('A photo with that id already exists');
        }
        // A retry: a fresh link for the same object.
        return {
          photo: await toPhoto(existing, null),
          uploadUrl: await storage.uploadUrl(existing.storageKey, existing.contentType, ttl),
          expiresIn: ttl,
        };
      }

      const storageKey = `trips/${tripId}/photos/${id}/original.${EXTENSIONS[input.contentType]}`;
      const [row] = await db
        .insert(photos)
        .values({
          id,
          tripId,
          uploadedBy: userId,
          batchId: input.batchId,
          storageKey,
          contentType: input.contentType,
          sizeBytes: input.sizeBytes,
          width: input.width ?? null,
          height: input.height ?? null,
          takenAt: input.takenAt ?? null,
          latitude: input.latitude ?? null,
          longitude: input.longitude ?? null,
          caption: input.caption ?? null,
          status: 'pending',
        })
        .returning();

      return {
        photo: await toPhoto(row!, null),
        uploadUrl: await storage.uploadUrl(storageKey, input.contentType, ttl),
        expiresIn: ttl,
      };
    },

    /**
     * Step two: the phone says it's done. Nobody else sees the photo until
     * we've confirmed the bytes arrived. Then the worker makes the thumbnail.
     */
    async complete(photoId: string, userId: string, origin?: string) {
      const { photo, uploaderName } = await loadLive(photoId);
      await requireTripRole(db, photo.tripId, userId, 'editor');
      if (photo.uploadedBy !== userId) throw notFound('That photo is no longer here');
      if (photo.status === 'ready') return toPhoto(photo, uploaderName);

      const size = await storage.sizeOf(photo.storageKey);
      if (size === null) throw badRequest('The photo didn’t arrive. Try again.', 'upload_missing');

      const ready = await db.transaction(async (tx) => {
        const [row] = await tx
          .update(photos)
          .set({ status: 'ready', sizeBytes: size, version: sql`${photos.version} + 1` })
          .where(eq(photos.id, photoId))
          .returning();
        await tx.insert(changeLog).values({
          tripId: photo.tripId,
          entity: 'photo',
          entityId: photoId,
          op: 'upsert',
          changedBy: userId,
        });
        return row!;
      });

      await jobs.makeThumbnail(photoId);
      // No payload: each phone fetches its own signed copy.
      await publishTripEvent(redis, {
        type: 'photo.upserted',
        tripId: photo.tripId,
        entityId: photoId,
        actorId: userId,
        version: ready.version,
        originClientId: origin,
      });
      return toPhoto(ready, uploaderName);
    },

    /**
     * Once a pick has finished uploading: one card in the chat for the whole
     * batch ("Riya added 40 photos"), not one per photo. Safe to call twice.
     */
    async finishBatch(tripId: string, batchId: string, userId: string) {
      await requireTripRole(db, tripId, userId, 'editor');
      const [{ count } = { count: 0 }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(photos)
        .where(
          and(
            eq(photos.tripId, tripId),
            eq(photos.batchId, batchId),
            eq(photos.uploadedBy, userId),
            eq(photos.status, 'ready'),
            isNull(photos.deletedAt),
          ),
        );
      if (count === 0) return { posted: false, count };

      const card = await db
        .transaction(async (tx) =>
          postSystemMessage(
            tx,
            tripId,
            userId,
            (name) => `${name} added ${count === 1 ? 'a photo' : `${count} photos`}`,
            { event: 'photos_added', batchId, count },
          ),
        )
        // The unique index on a card's batchId turned a second card away: it's already posted.
        .catch((e: unknown) => {
          if (isUniqueViolation(e)) return null;
          throw e;
        });

      if (card) {
        await publishTripEvent(redis, {
          type: 'message.created',
          tripId,
          entityId: card.id,
          actorId: userId,
          payload: card,
        });
      }
      return { posted: card !== null, count };
    },

    /** The uploader or a trip owner can remove a photo, and the bytes go with it. */
    async remove(photoId: string, userId: string, origin?: string) {
      const { photo } = await loadLive(photoId);
      const role = await requireTripRole(db, photo.tripId, userId, 'editor');
      if (photo.uploadedBy !== userId && role !== 'owner') {
        throw notFound('That photo is no longer here');
      }

      const [deleted] = await db
        .update(photos)
        .set({ deletedAt: new Date(), version: sql`${photos.version} + 1` })
        .where(and(eq(photos.id, photoId), isNull(photos.deletedAt)))
        .returning({ version: photos.version });
      if (!deleted) return;

      await db.insert(changeLog).values({
        tripId: photo.tripId,
        entity: 'photo',
        entityId: photoId,
        op: 'delete',
        changedBy: userId,
      });
      // Best effort: a row nobody can see matters more than a stray object.
      await Promise.all(
        [photo.storageKey, photo.thumbKey]
          .filter((k): k is string => k !== null)
          .map((k) => storage.remove(k).catch(() => {})),
      );

      await publishTripEvent(redis, {
        type: 'photo.deleted',
        tripId: photo.tripId,
        entityId: photoId,
        actorId: userId,
        version: deleted.version,
        originClientId: origin,
      });
    },
  };
};
