import { Queue } from 'bullmq';
import type { NotificationKind } from '@tagalong/shared';
import type { Redis } from 'ioredis';

export const NOTIFY_QUEUE = 'notify';
/** How long to wait before notifying, so a burst of messages becomes one push. */
export const NOTIFY_DELAY_MS = 20_000;

export interface NotifyJob {
  tripId: string;
  userId: string;
}

/** Plan, money, to-do or trip changes for one person, summed up after a short wait. */
export interface ActivityJob {
  tripId: string;
  userId: string;
  kind: Exclude<NotificationKind, 'chat' | 'mentions'>;
}

/** Someone was @mentioned: tell them now, not in the next summary. */
export interface MentionJob {
  tripId: string;
  messageId: string;
  userId: string;
}

/** Fetching a link's title and picture runs apart from everything else: it waits on other people's servers. */
export const PREVIEW_QUEUE = 'preview';

export interface LinkPreviewJob {
  messageId: string;
}

/** Image work gets its own queue, so a slow resize never holds up a push. */
export const MEDIA_QUEUE = 'media';

export interface ThumbnailJob {
  photoId: string;
}

/** Background work the API hands to the worker. Tests swap in a recorder. */
export interface Jobs {
  notifyChat(tripId: string, userIds: string[]): Promise<void>;
  notifyMention(tripId: string, messageId: string, userIds: string[]): Promise<void>;
  /** Plan, money, to-do and trip changes, batched like chat; `now` skips the wait (due-tomorrow). */
  notifyActivity(kind: ActivityJob['kind'], tripId: string, userIds: string[], now?: boolean): Promise<void>;
  makeThumbnail(photoId: string): Promise<void>;
  linkPreview(messageId: string): Promise<void>;
  close(): Promise<void>;
}

export const bullJobs = (redis: Redis): Jobs => {
  const notify = new Queue<NotifyJob | MentionJob | ActivityJob>(NOTIFY_QUEUE, { connection: redis });
  const media = new Queue<ThumbnailJob>(MEDIA_QUEUE, { connection: redis });
  const preview = new Queue<LinkPreviewJob>(PREVIEW_QUEUE, { connection: redis });
  return {
    async notifyChat(tripId, userIds) {
      if (userIds.length === 0) return;
      // One job id per person per trip: while one is waiting, more messages
      // don't add more jobs, so the worker sends a single summary.
      await notify.addBulk(
        userIds.map((userId) => ({
          name: 'chat',
          data: { tripId, userId },
          opts: {
            jobId: `notify-${tripId}-${userId}`,
            delay: NOTIFY_DELAY_MS,
            removeOnComplete: true,
            removeOnFail: true,
          },
        })),
      );
    },
    async notifyMention(tripId, messageId, userIds) {
      if (userIds.length === 0) return;
      await notify.addBulk(
        userIds.map((userId) => ({
          name: 'mention',
          data: { tripId, messageId, userId },
          opts: { jobId: `mention-${messageId}-${userId}`, removeOnComplete: true, removeOnFail: true },
        })),
      );
    },
    async notifyActivity(kind, tripId, userIds, now = false) {
      if (userIds.length === 0) return;
      // One waiting job per person, trip and kind: a burst of changes becomes one push.
      await notify.addBulk(
        userIds.map((userId) => ({
          name: 'activity',
          data: { tripId, userId, kind },
          opts: {
            jobId: `activity-${kind}-${tripId}-${userId}`,
            delay: now ? 0 : NOTIFY_DELAY_MS,
            removeOnComplete: true,
            removeOnFail: true,
          },
        })),
      );
    },
    async linkPreview(messageId) {
      await preview.add(
        'link-preview',
        { messageId },
        // An edit can change the link, so each try gets its own job.
        { attempts: 2, backoff: { type: 'fixed', delay: 5_000 }, removeOnComplete: true, removeOnFail: 50 },
      );
    },
    async makeThumbnail(photoId) {
      await media.add(
        'thumbnail',
        { photoId },
        {
          // One job per photo, so a retried "complete" can't queue it twice.
          jobId: `thumb-${photoId}`,
          attempts: 3,
          backoff: { type: 'exponential', delay: 2_000 },
          removeOnComplete: true,
          removeOnFail: 100,
        },
      );
    },
    close: async () => {
      await Promise.all([notify.close(), media.close(), preview.close()]);
    },
  };
};
