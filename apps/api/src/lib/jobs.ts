import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';

export const NOTIFY_QUEUE = 'notify';
/** How long to wait before notifying, so a burst of messages becomes one push. */
export const NOTIFY_DELAY_MS = 20_000;

export interface NotifyJob {
  tripId: string;
  userId: string;
}

/** Image work gets its own queue, so a slow resize never holds up a push. */
export const MEDIA_QUEUE = 'media';

export interface ThumbnailJob {
  photoId: string;
}

/** Background work the API hands to the worker. Tests swap in a recorder. */
export interface Jobs {
  notifyChat(tripId: string, userIds: string[]): Promise<void>;
  makeThumbnail(photoId: string): Promise<void>;
  close(): Promise<void>;
}

export const bullJobs = (redis: Redis): Jobs => {
  const notify = new Queue<NotifyJob>(NOTIFY_QUEUE, { connection: redis });
  const media = new Queue<ThumbnailJob>(MEDIA_QUEUE, { connection: redis });
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
      await Promise.all([notify.close(), media.close()]);
    },
  };
};
