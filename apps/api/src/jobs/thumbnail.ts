import { and, eq, isNull, sql } from 'drizzle-orm';
import { photos, type Db } from '@tagalong/db';
import type { Redis } from 'ioredis';
import sharp from 'sharp';
import { publishTripEvent } from '../lib/events';
import type { ThumbnailJob } from '../lib/jobs';
import type { Storage } from '../lib/storage';

/** Wide enough for a three-column grid on a large phone at 3x density. */
export const THUMB_SIZE = 480;

interface Deps {
  db: Db;
  redis: Redis;
  storage: Storage;
}

export type ThumbnailResult =
  | { made: true; width: number; height: number; bytes: number }
  | { skipped: 'gone' | 'not_ready' | 'already_done' };

/**
 * Makes the small preview the album grid shows. Throwing makes BullMQ retry,
 * so a missing original (storage hiccup) is retried; a photo that's been
 * deleted or already has a thumbnail is simply skipped.
 */
export const processThumbnail = async (
  { db, redis, storage }: Deps,
  { photoId }: ThumbnailJob,
): Promise<ThumbnailResult> => {
  const [photo] = await db
    .select()
    .from(photos)
    .where(and(eq(photos.id, photoId), isNull(photos.deletedAt)));
  if (!photo) return { skipped: 'gone' };
  if (photo.status !== 'ready') return { skipped: 'not_ready' };
  if (photo.thumbKey) return { skipped: 'already_done' };

  const original = await storage.read(photo.storageKey);
  if (!original) throw new Error(`Original missing for photo ${photoId}`);

  // `rotate()` with no angle applies the camera's orientation tag, so a photo
  // taken holding the phone sideways isn't shown sideways.
  const image = sharp(original).rotate();
  const { width, height } = await image.metadata().then(async (meta) => {
    // Orientations 5–8 swap width and height once applied.
    const turned = (meta.orientation ?? 1) >= 5;
    return {
      width: (turned ? meta.height : meta.width) ?? 0,
      height: (turned ? meta.width : meta.height) ?? 0,
    };
  });
  const thumb = await image
    .resize({ width: THUMB_SIZE, height: THUMB_SIZE, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 72 })
    .toBuffer();

  const thumbKey = photo.storageKey.replace(/[^/]+$/, 'thumb.webp');
  await storage.write(thumbKey, thumb, 'image/webp');

  const [updated] = await db
    .update(photos)
    .set({
      thumbKey,
      // The phone's numbers can be missing (web) or pre-rotation; the real image is the truth.
      width,
      height,
      version: sql`${photos.version} + 1`,
    })
    .where(and(eq(photos.id, photoId), isNull(photos.deletedAt)))
    .returning({ version: photos.version });
  if (!updated) {
    // Deleted while we worked: don't leave the thumbnail behind.
    await storage.remove(thumbKey).catch(() => {});
    return { skipped: 'gone' };
  }

  // No payload: links are signed per viewer, so each phone fetches its own copy.
  await publishTripEvent(redis, {
    type: 'photo.upserted',
    tripId: photo.tripId,
    entityId: photoId,
    actorId: photo.uploadedBy,
    version: updated.version,
  });
  return { made: true, width, height, bytes: thumb.length };
};
