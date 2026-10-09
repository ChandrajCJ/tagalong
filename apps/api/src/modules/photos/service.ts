import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { changeLog, items, photoFavourites, photos, users, type Db } from '@tagalong/db';
import { CreatePhotoInput, newId, photoWindow, type Photo } from '@tagalong/shared';
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
type Fav = { count: number; mine: boolean };
const NO_FAVS: Fav = { count: 0, mine: false };

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
  /** Heart counts for many photos in one query, and which ones this person hearted. */
  const favouritesFor = async (photoIds: string[], userId: string) => {
    const counts = new Map<string, Fav>();
    if (photoIds.length === 0) return counts;
    const rows = await db
      .select({
        photoId: photoFavourites.photoId,
        count: sql<number>`count(*)::int`,
        mine: sql<boolean>`bool_or(${photoFavourites.userId} = ${userId})`,
      })
      .from(photoFavourites)
      .where(inArray(photoFavourites.photoId, photoIds))
      .groupBy(photoFavourites.photoId);
    for (const r of rows) counts.set(r.photoId, { count: r.count, mine: r.mine });
    return counts;
  };

  /** Rows to app-shaped photos, with hearts and freshly signed links. */
  const hydrate = async (rows: { photo: Row; uploaderName: string | null }[], userId: string) => {
    const favs = await favouritesFor(
      rows.map((r) => r.photo.id),
      userId,
    );
    return Promise.all(rows.map((r) => toPhoto(r.photo, r.uploaderName, favs.get(r.photo.id))));
  };

  const toPhoto = async (r: Row, uploaderName: string | null, fav: Fav = NO_FAVS): Promise<Photo> => {
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
      favourites: fav.count,
      favourited: fav.mine,
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
        photos: await hydrate(rows, userId),
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
      const [one] = await hydrate([{ photo, uploaderName }], userId);
      return one!;
    },

    /**
     * The photos taken during a plan item, by comparing wall-clock times: the
     * item's date and times against each photo's EXIF time. An item with no
     * start time claims none, rather than every photo of its day.
     */
    async forItem(itemId: string, userId: string) {
      const [item] = await db
        .select()
        .from(items)
        .where(and(eq(items.id, itemId), isNull(items.deletedAt)));
      if (!item) throw notFound('That item no longer exists');
      await requireTripRole(db, item.tripId, userId, 'viewer');

      const window = photoWindow({
        date: item.date,
        startTime: item.startTime?.slice(0, 5) ?? null,
        endTime: item.endTime?.slice(0, 5) ?? null,
      });
      if (!window) return { photos: [], expiresIn: ttl };

      const rows = await db
        .select({ photo: photos, uploaderName: users.displayName })
        .from(photos)
        .innerJoin(users, eq(users.id, photos.uploadedBy))
        .where(
          and(
            eq(photos.tripId, item.tripId),
            eq(photos.status, 'ready'),
            isNull(photos.deletedAt),
            sql`${photos.takenAt} between ${window.from}::timestamp and ${window.to}::timestamp`,
          ),
        )
        .orderBy(asc(photos.takenAt), asc(photos.id));
      return { photos: await hydrate(rows, userId), expiresIn: ttl };
    },

    /**
     * A heart, on or off. Open to viewers: liking a photo is an opinion, not
     * an edit. Returns the new count so every album can update.
     */
    async favourite(photoId: string, userId: string, on: boolean, origin?: string) {
      const { photo } = await loadLive(photoId);
      await requireTripRole(db, photo.tripId, userId, 'viewer');
      if (photo.status !== 'ready') throw notFound('That photo is no longer here');

      if (on) {
        await db.insert(photoFavourites).values({ photoId, userId }).onConflictDoNothing();
      } else {
        await db
          .delete(photoFavourites)
          .where(and(eq(photoFavourites.photoId, photoId), eq(photoFavourites.userId, userId)));
      }
      const [{ count } = { count: 0 }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(photoFavourites)
        .where(eq(photoFavourites.photoId, photoId));

      const change = { photoId, userId, added: on, count };
      await publishTripEvent(redis, {
        type: 'photo.favourited',
        tripId: photo.tripId,
        entityId: photoId,
        actorId: userId,
        payload: change,
        originClientId: origin,
      });
      return { favourites: count, favourited: on };
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
