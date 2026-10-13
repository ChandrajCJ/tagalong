import {
  expoPushSender,
  imapMailbox,
  INBOX_QUEUE,
  MEDIA_QUEUE,
  NOTIFY_QUEUE,
  processInbox,
  processNotify,
  processThumbnail,
  s3Storage,
  type NotifyJob,
  type ThumbnailJob,
} from '@tagalong/api/jobs';
import { createDb } from '@tagalong/db';
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import pino from 'pino';
import { z } from 'zod';

/** Docker Compose passes an unset setting as "": treat that as not set. */
const unset = (v: unknown) => (v === '' ? undefined : v);

const env = z
  .object({
    NODE_ENV: z.string().default('development'),
    REDIS_URL: z.string().url(),
    DATABASE_URL: z.string().url(),
    S3_ENDPOINT: z.string().url().default('http://localhost:8333'),
    S3_REGION: z.string().default('us-east-1'),
    S3_BUCKET: z.string().default('tagalong'),
    S3_ACCESS_KEY: z.string().default('tagalong'),
    S3_SECRET_KEY: z.string().default('tagalong-secret'),
    /** Bookings by email (docs/DEPLOY.md): imaps://user:app-password@imap.gmail.com:993 and its address. */
    IMPORT_IMAP_URL: z.preprocess(unset, z.string().url().optional()),
    IMPORT_ADDRESS: z.preprocess(unset, z.string().email().optional()),
    /** Whose Authentication-Results headers to trust: the receiving server's. */
    IMPORT_AUTHSERV_ID: z.string().default('mx.google.com'),
  })
  .parse(process.env);

const log = pino(
  env.NODE_ENV === 'development' ? { transport: { target: 'pino-pretty' } } : {},
);
const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
const redis = new Redis(env.REDIS_URL);
const { db, close: closeDb } = createDb(env.DATABASE_URL, { max: 5 });
const storage = s3Storage(env);

// One queue per workload keeps slow jobs (video, AI) from blocking fast ones (push).
const system = new Worker(
  'system',
  async (job) => {
    if (job.name === 'ping') {
      log.info({ data: job.data }, 'Received ping from the API. The queue is working.');
      return { pong: true };
    }
    throw new Error(`Unknown system job: ${job.name}`);
  },
  { connection },
);

const notify = new Worker<NotifyJob>(
  NOTIFY_QUEUE,
  async (job) => {
    const result = await processNotify({ db, redis, push: expoPushSender }, job.data);
    log.info({ ...job.data, result }, 'Chat notification');
    return result;
  },
  { connection, concurrency: 5 },
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

// Forwarded booking emails: read the inbox every two minutes, one run at a time.
const inboxOn = !!(env.IMPORT_IMAP_URL && env.IMPORT_ADDRESS);
const inbox = inboxOn
  ? new Worker(
      INBOX_QUEUE,
      async () => {
        const mailbox = await imapMailbox(env.IMPORT_IMAP_URL!);
        try {
          const outcomes = await processInbox({
            db,
            redis,
            storage,
            mailbox,
            inboxAddress: env.IMPORT_ADDRESS!,
            authservId: env.IMPORT_AUTHSERV_ID,
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

for (const worker of [system, notify, media, ...(inbox ? [inbox] : [])]) {
  worker.on('failed', (job, err) => log.error({ queue: worker.name, job: job?.name, err }, 'Job failed'));
}
log.info(
  inboxOn
    ? 'Worker started, listening on queues "system", "notify", "media" and "inbox"'
    : 'Worker started, listening on queues "system", "notify" and "media" (bookings by email is off: IMPORT_IMAP_URL is unset)',
);

const shutdown = async () => {
  await Promise.all([system.close(), notify.close(), media.close(), inbox?.close()]);
  connection.disconnect();
  redis.disconnect();
  await closeDb();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
