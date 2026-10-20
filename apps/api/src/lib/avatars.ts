import { avatarVersionOf } from '@tagalong/shared';
import type { Storage } from './storage';

/** How long an avatar link lasts: an hour, so a list of members doesn't go stale while open. */
export const AVATAR_LINK_TTL = 60 * 60;

/**
 * A profile photo's short-lived link and its version, or nulls for someone
 * without one (the app shows their initials). The version changes with the
 * photo, so the app's cache keeps a photo across links and drops a replaced one.
 */
export const avatarOf = async (storage: Storage | undefined, key: string | null) =>
  key && storage
    ? { avatarUrl: await storage.downloadUrl(key, 'avatar.jpg', AVATAR_LINK_TTL), avatarVersion: avatarVersionOf(key) }
    : { avatarUrl: null, avatarVersion: null };
