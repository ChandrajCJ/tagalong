import { eq, lt } from 'drizzle-orm';
import { changeLog, documents, photos, trips, type Db } from '@tagalong/db';
import { TRIP_RESTORE_DAYS } from '@tagalong/shared';
import type { Storage } from '../lib/storage';

/** The daily job that removes trips deleted more than TRIP_RESTORE_DAYS ago. */
export const PURGE_JOB = 'purge-deleted-trips';

export interface PurgeResult {
  trips: number;
  files: number;
}

/**
 * Removes deleted trips for good once the owner's time to restore them has
 * passed: first every file they hold (photos, thumbnails, documents), then
 * the rows, which cascade from the trip. Files go first so a storage hiccup
 * leaves the trip in place for tomorrow's run, never files without an owner.
 */
export const purgeDeletedTrips = async (
  { db, storage }: { db: Db; storage: Storage },
  now = new Date(),
): Promise<PurgeResult> => {
  const cutoff = new Date(now.getTime() - TRIP_RESTORE_DAYS * 24 * 60 * 60 * 1000);
  const due = await db.select({ id: trips.id }).from(trips).where(lt(trips.deletedAt, cutoff));

  let files = 0;
  for (const { id } of due) {
    const photoKeys = await db
      .select({ a: photos.storageKey, b: photos.thumbKey })
      .from(photos)
      .where(eq(photos.tripId, id));
    const documentKeys = await db
      .select({ a: documents.storageKey, b: documents.thumbnailKey })
      .from(documents)
      .where(eq(documents.tripId, id));
    const keys = [...photoKeys, ...documentKeys].flatMap((r) => [r.a, r.b]).filter((k): k is string => !!k);
    for (const key of keys) await storage.remove(key);
    files += keys.length;

    await db.transaction(async (tx) => {
      // The change log has no foreign key (it outlives deletes), so clear it by hand.
      await tx.delete(changeLog).where(eq(changeLog.tripId, id));
      await tx.delete(trips).where(eq(trips.id, id));
    });
  }
  return { trips: due.length, files };
};
