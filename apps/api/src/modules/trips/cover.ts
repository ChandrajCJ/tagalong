import { and, eq, isNull, ne, sql } from 'drizzle-orm';
import { changeLog, photos, trips, type Db, type Tx } from '@tagalong/db';
import { newId, SetCoverInput, type CoverSuggestion } from '@tagalong/shared';
import type { Redis } from 'ioredis';
import sharp from 'sharp';
import type { z } from 'zod';
import { requireTripRole } from '../../lib/access';
import { badRequest, notFound } from '../../lib/errors';
import { publishTripEvent } from '../../lib/events';
import type { Geo } from '../../lib/geo';
import type { Jobs } from '../../lib/jobs';
import type { Storage } from '../../lib/storage';

type SetCover = z.output<typeof SetCoverInput>;

const EXTENSIONS: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

/**
 * A trip's cover photo. It's a photo row like any other: uploaded as a cover,
 * picked from the album, or downloaded from Wikipedia (only from Wikipedia's
 * image server, through the guarded fetch). Cover-only photos are removed
 * when replaced; album photos stay in the album.
 */
export const createCoverService = (db: Db, redis: Redis, storage: Storage, jobs: Jobs, geo: Geo) => {
  /** Takes the old cover away if nothing else uses it: cover-only photos go, album ones stay. */
  const dropOldCover = async (tx: Tx, tripId: string, oldId: string | null, keepId: string | null) => {
    if (!oldId || oldId === keepId) return [];
    return tx
      .update(photos)
      .set({ deletedAt: new Date(), version: sql`${photos.version} + 1` })
      .where(and(eq(photos.id, oldId), eq(photos.tripId, tripId), eq(photos.source, 'cover'), isNull(photos.deletedAt)))
      .returning({ storageKey: photos.storageKey, thumbKey: photos.thumbKey });
  };

  const removeFiles = (files: { storageKey: string; thumbKey: string | null }[]) =>
    Promise.all(
      files.flatMap((f) => [f.storageKey, f.thumbKey]).filter((k): k is string => !!k).map((k) => storage.remove(k).catch(() => {})),
    );

  /** Points the trip at a cover photo (or none), tidies up the old one, and tells everyone. */
  const point = async (tripId: string, userId: string, photoId: string | null, credit: string | null) => {
    const files = await db.transaction(async (tx) => {
      const [current] = await tx.select({ coverMediaId: trips.coverMediaId }).from(trips).where(eq(trips.id, tripId));
      const [row] = await tx
        .update(trips)
        .set({ coverMediaId: photoId, coverCredit: credit, version: sql`${trips.version} + 1` })
        .where(and(eq(trips.id, tripId), isNull(trips.deletedAt)))
        .returning({ version: trips.version });
      if (!row) throw notFound('Trip not found');
      await tx.insert(changeLog).values({ tripId, entity: 'trip', entityId: tripId, op: 'upsert', changedBy: userId });
      return { version: row.version, files: await dropOldCover(tx, tripId, current?.coverMediaId ?? null, photoId) };
    });
    await removeFiles(files.files);
    await publishTripEvent(redis, { type: 'trip.updated', tripId, entityId: tripId, actorId: userId, version: files.version });
  };

  /** Saves a downloaded Wikipedia picture as the trip's own cover-only photo. */
  const storeWikipediaImage = async (tripId: string, userId: string, url: string) => {
    const { contentType, body } = await geo.fetchImage(url).catch(() => {
      throw badRequest('Couldn’t get that photo from Wikipedia. Try again.', 'cover_unavailable');
    });
    const ext = EXTENSIONS[contentType];
    if (!ext) throw badRequest('That isn’t a photo we can use', 'cover_unavailable');
    const meta = await sharp(body)
      .metadata()
      .catch(() => null);
    if (!meta?.width || !meta.height) throw badRequest('That isn’t a photo we can use', 'cover_unavailable');

    const id = newId();
    const storageKey = `trips/${tripId}/photos/${id}/original.${ext}`;
    await storage.write(storageKey, body, contentType);
    await db.insert(photos).values({
      id,
      tripId,
      uploadedBy: userId,
      batchId: id,
      storageKey,
      contentType,
      sizeBytes: body.length,
      width: meta.width,
      height: meta.height,
      status: 'ready',
      source: 'cover',
    });
    await jobs.makeThumbnail(id);
    return id;
  };

  return {
    /** Editors and owners choose the cover; everyone sees it. */
    async set(tripId: string, userId: string, input: SetCover) {
      await requireTripRole(db, tripId, userId, 'editor');
      if ('photoId' in input) {
        const [photo] = await db
          .select({ source: photos.source })
          .from(photos)
          .where(
            and(
              eq(photos.id, input.photoId),
              eq(photos.tripId, tripId),
              eq(photos.status, 'ready'),
              isNull(photos.deletedAt),
              // A photo sent in the chat is someone's message, not a cover, until it's in the album.
              ne(photos.source, 'chat'),
            ),
          );
        if (!photo) throw badRequest('Pick a photo from this trip', 'cover_not_trip_photo');
        await point(tripId, userId, input.photoId, null);
        return;
      }
      const photoId = await storeWikipediaImage(tripId, userId, input.wikipediaUrl);
      await point(tripId, userId, photoId, input.credit ?? null);
    },

    /** "Remove photo": back to the colour. */
    async remove(tripId: string, userId: string) {
      await requireTripRole(db, tripId, userId, 'editor');
      await point(tripId, userId, null, null);
    },

    /** The destination's photo on Wikipedia, if it has one, offered on Edit trip. */
    async suggestion(tripId: string, userId: string): Promise<CoverSuggestion | null> {
      await requireTripRole(db, tripId, userId, 'viewer');
      const [trip] = await db.select({ destination: trips.destination }).from(trips).where(eq(trips.id, tripId));
      const name = trip?.destination.split(',')[0]?.trim();
      if (!name) return null;
      return geo.destinationPhoto(name).catch(() => null);
    },
  };
};
