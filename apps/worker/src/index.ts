import {
  expoPushSender,
  MEDIA_QUEUE,
  NOTIFY_QUEUE,
  processNotify,
  processThumbnail,
  s3Storage,
  type NotifyJob,
  type ThumbnailJob,
} from '@tagalong/api/jobs';
import { createDb } from '@tagalong/db';
import { Worker } from 'bullmq';
import { Redis } from 'ioredis';
import pino from 'pino';
import { z } from 'zod';

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

for (const worker of [system, notify, media]) {
  worker.on('failed', (job, err) => log.error({ queue: worker.name, job: job?.name, err }, 'Job failed'));
}
log.info('Worker started, listening on queues "system", "notify" and "media"');

const shutdown = async () => {
  await Promise.all([system.close(), notify.close(), media.close()]);
  connection.disconnect();
  redis.disconnect();
  await closeDb();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
