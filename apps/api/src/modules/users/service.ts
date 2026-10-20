import { and, eq, isNull, sql } from 'drizzle-orm';
import { tripMembers, trips, users, type Db } from '@tagalong/db';
import { AVATAR_MAX_BYTES, type AvatarUpload, type AvatarUploadInput } from '@tagalong/shared';
import { randomBytes } from 'node:crypto';
import { AVATAR_LINK_TTL } from '../../lib/avatars';
import { badRequest, notFound } from '../../lib/errors';
import type { Storage } from '../../lib/storage';

const EXTENSION = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' } as const;

/** Profile photos: upload, replace, remove, and show only to people who share a trip. */
export const createUsersService = (db: Db, storage: Storage, uploadTtl: number) => {
  const avatarKeyOf = async (userId: string) =>
    (await db.select({ key: users.avatarKey }).from(users).where(eq(users.id, userId)))[0]?.key ?? null;

  /** The old photo goes once the new one is in place; a failure there leaves only a stray file. */
  const replace = async (userId: string, key: string | null) => {
    const old = await avatarKeyOf(userId);
    await db.update(users).set({ avatarKey: key }).where(eq(users.id, userId));
    if (old && old !== key) await storage.remove(old).catch(() => undefined);
  };

  return {
    /** Where to upload a new photo: a fresh key under the person's own folder. */
    async uploadUrl(userId: string, input: AvatarUploadInput): Promise<AvatarUpload> {
      const key = `avatars/${userId}/${randomBytes(9).toString('base64url')}.${EXTENSION[input.contentType]}`;
      return { key, uploadUrl: await storage.uploadUrl(key, input.contentType, uploadTtl) };
    },

    /** The uploaded photo becomes the profile photo, if it's theirs, arrived, and isn't too big. */
    async set(userId: string, key: string) {
      if (!key.startsWith(`avatars/${userId}/`) || !/\.(jpg|png|webp)$/.test(key)) throw badRequest('That isn’t your upload');
      const size = await storage.sizeOf(key);
      if (size === null) throw badRequest('The photo didn’t arrive. Try again.', 'upload_missing');
      if (size > AVATAR_MAX_BYTES) {
        await storage.remove(key).catch(() => undefined);
        throw badRequest('That photo is too big (2 MB at most)', 'too_big');
      }
      await replace(userId, key);
    },

    async remove(userId: string) {
      await replace(userId, null);
    },

    /**
     * A link to someone's photo, for yourself or anyone you share a trip with
     * (deleted trips and people who left don't count). Everyone else gets 404,
     * as if there were no photo.
     */
    async link(viewerId: string, userId: string) {
      if (viewerId !== userId) {
        const [shared] = await db
          .select({ one: sql<number>`1` })
          .from(tripMembers)
          .innerJoin(trips, and(eq(trips.id, tripMembers.tripId), isNull(trips.deletedAt)))
          .where(
            and(
              eq(tripMembers.userId, viewerId),
              isNull(tripMembers.leftAt),
              sql`exists (select 1 from ${tripMembers} other where other.trip_id = ${tripMembers.tripId}
                and other.user_id = ${userId} and other.left_at is null)`,
            ),
          )
          .limit(1);
        if (!shared) throw notFound('No photo');
      }
      const key = await avatarKeyOf(userId);
      if (!key) throw notFound('No photo');
      return storage.downloadUrl(key, 'avatar.jpg', AVATAR_LINK_TTL);
    },
  };
};
