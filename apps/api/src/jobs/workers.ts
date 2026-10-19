import type { Db } from '@tagalong/db';
import { Queue, Worker } from 'bullmq';
import type { Redis } from 'ioredis';
import {
  MEDIA_QUEUE,
  NOTIFY_QUEUE,
  PREVIEW_QUEUE,
  type ActivityJob,
  type LinkPreviewJob,
  type MentionJob,
  type NotifyJob,
  type ThumbnailJob,
} from '../lib/jobs';
import type { Storage } from '../lib/storage';
import { imapMailbox, INBOX_QUEUE, processInbox } from './inbox';
import { expoPushSender, processActivity, processMention, processNotify } from './notify';
import { processLinkPreview } from './preview';
import { PURGE_JOB, purgeDeletedTrips } from './purge';
import { DUE_JOB, queueDueTomorrow } from './due';
import { bullJobs } from '../lib/jobs';
import { createNotifier } from '../lib/notifier';
import { processThumbnail } from './thumbnail';

export interface WorkerLog {
  info: (o: object, msg: string) => void;
  warn: (o: object, msg: string) => void;
  error: (o: object, msg: string) => void;
}

export interface WorkerDeps {
  db: Db;
  /** For job processors' own commands. */
  redis: Redis;
  /** For BullMQ's blocking reads: needs `maxRetriesPerRequest: null`. */
  connection: Redis;
  storage: Storage;
  log: WorkerLog;
  /** Bookings by email: the inbox over IMAP and its address. Off unless both are set. */
  imapUrl?: string;
  importAddress?: string;
  authservId: string;
  /** The app's own web addresses: links to them (invites) get no preview card. */
  ownHosts?: string[];
}

/**
 * Starts the background job workers: chat push notifications, photo
 * thumbnails and, when configured, reading forwarded booking emails. Runs in
 * its own process (apps/worker) or inside the API's (src/all.ts) on a host
 * with only one free server.
 */
export const startWorkers = async ({
  db,
  redis,
  connection,
  storage,
  log,
  imapUrl,
  importAddress,
  authservId,
  ownHosts,
}: WorkerDeps) => {
  // The due-tomorrow job queues its pushes the same way the API does.
  const jobs = bullJobs(connection);
  const notifier = createNotifier(db, redis, jobs);

  // One queue per workload keeps slow jobs (video, AI) from blocking fast ones (push).
  const system = new Worker(
    'system',
    async (job) => {
      if (job.name === 'ping') {
        log.info({ data: job.data }, 'Received ping from the API. The queue is working.');
        return { pong: true };
      }
      if (job.name === DUE_JOB) {
        const result = await queueDueTomorrow({ db, redis, notifier });
        if (result.queued) log.info(result, 'To-dos due tomorrow');
        return result;
      }
      if (job.name === PURGE_JOB) {
        const result = await purgeDeletedTrips({ db, storage });
        if (result.trips) log.info(result, 'Purged deleted trips');
        return result;
      }
      throw new Error(`Unknown system job: ${job.name}`);
    },
    { connection },
  );

  const notify = new Worker<NotifyJob | MentionJob | ActivityJob>(
    NOTIFY_QUEUE,
    async (job) => {
      if (job.name === 'mention') {
        const result = await processMention({ db, redis, push: expoPushSender }, job.data as MentionJob);
        log.info({ ...job.data, result }, 'Mention notification');
        return result;
      }
      if (job.name === 'activity') {
        const result = await processActivity({ db, redis, push: expoPushSender }, job.data as ActivityJob);
        log.info({ ...job.data, result }, 'Activity notification');
        return result;
      }
      const result = await processNotify({ db, redis, push: expoPushSender }, job.data as NotifyJob);
      log.info({ ...job.data, result }, 'Chat notification');
      return result;
    },
    { connection, concurrency: 5 },
  );

  // Link previews wait on other people's servers, so they get their own lane.
  const preview = new Worker<LinkPreviewJob>(
    PREVIEW_QUEUE,
    async (job) => {
      const result = await processLinkPreview({ db, redis, ownHosts }, job.data);
      log.info({ ...job.data, result: 'added' in result ? 'added' : result.skipped }, 'Link preview');
      return result;
    },
    { connection, concurrency: 3 },
  );

  // Resizing is CPU-bound: two at a time keeps the machine responsive.
  const media = new Worker<ThumbnailJob>(
    MEDIA_QUEUE,
    async (job) => {
      const result = await processThumbnail({ db, redis, storage }, job.data);
      log.info({ ...job.data, result }, 'Thumbnail');
      return result;
    },
    { connection, concurrency: 2 },
  );

  // Deleted trips past their restore window go for good, once a day at 03:00 UTC.
  const systemQueue = new Queue('system', { connection });
  await systemQueue.upsertJobScheduler(PURGE_JOB, { pattern: '0 3 * * *' }, { name: PURGE_JOB, opts: { removeOnComplete: 10, removeOnFail: 50 } });
  // To-dos due tomorrow: every hour, so each trip's evening comes round; each is sent once.
  await systemQueue.upsertJobScheduler(DUE_JOB, { pattern: '15 * * * *' }, { name: DUE_JOB, opts: { removeOnComplete: 10, removeOnFail: 50 } });
  await systemQueue.close();

  // Forwarded booking emails: read the inbox every two minutes, one run at a time.
  const inboxOn = !!(imapUrl && importAddress);
  const inbox = inboxOn
    ? new Worker(
        INBOX_QUEUE,
        async () => {
          const mailbox = await imapMailbox(imapUrl!);
          try {
            const outcomes = await processInbox({
              db,
              redis,
              storage,
              mailbox,
              inboxAddress: importAddress!,
              authservId,
              log,
            });
            if (outcomes.length) log.info({ read: outcomes.length, added: outcomes.filter((o) => o.result === 'added').length }, 'Inbox');
            return { read: outcomes.length };
          } finally {
            await mailbox.close();
          }
        },
        { connection, concurrency: 1 },
      )
    : null;
  if (inboxOn) {
    const queue = new Queue(INBOX_QUEUE, { connection });
    await queue.upsertJobScheduler('read-inbox', { every: 2 * 60_000 }, { name: 'read', opts: { removeOnComplete: 10, removeOnFail: 50 } });
    await queue.close();
  }

  for (const worker of [system, notify, media, preview, ...(inbox ? [inbox] : [])]) {
    worker.on('failed', (job, err) => log.error({ queue: worker.name, job: job?.name, err }, 'Job failed'));
  }
  log.info(
    {},
    inboxOn
      ? 'Worker started, listening on queues "system", "notify", "media", "preview" and "inbox"'
      : 'Worker started, listening on queues "system", "notify", "media" and "preview" (bookings by email is off: IMPORT_IMAP_URL is unset)',
  );

  return {
    close: async () => {
      await Promise.all([system.close(), notify.close(), media.close(), preview.close(), inbox?.close(), jobs.close()]);
    },
  };
};
