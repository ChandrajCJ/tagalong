import { expoPushSender, NOTIFY_QUEUE, processNotify, type NotifyJob } from '@tagalong/api/jobs';
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
  })
  .parse(process.env);

const log = pino(
  env.NODE_ENV === 'development' ? { transport: { target: 'pino-pretty' } } : {},
);
const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
const redis = new Redis(env.REDIS_URL);
const { db, close: closeDb } = createDb(env.DATABASE_URL, { max: 5 });

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

for (const worker of [system, notify]) {
  worker.on('failed', (job, err) => log.error({ queue: worker.name, job: job?.name, err }, 'Job failed'));
}
log.info('Worker started, listening on queues "system" and "notify"');

const shutdown = async () => {
  await Promise.all([system.close(), notify.close()]);
  connection.disconnect();
  redis.disconnect();
  await closeDb();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
