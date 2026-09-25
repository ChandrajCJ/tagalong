import { Worker } from 'bullmq';
import { Redis } from 'ioredis';
import pino from 'pino';
import { z } from 'zod';

const env = z
  .object({
    NODE_ENV: z.string().default('development'),
    REDIS_URL: z.string().url(),
  })
  .parse(process.env);

const log = pino(
  env.NODE_ENV === 'development' ? { transport: { target: 'pino-pretty' } } : {},
);
const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });

// One queue per workload keeps slow jobs (video, AI) from blocking fast ones (push).
// Only the system queue exists in week 1.
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

system.on('failed', (job, err) => log.error({ job: job?.name, err }, 'Job failed'));
log.info('Worker started, listening on queue "system"');

const shutdown = async () => {
  await system.close();
  connection.disconnect();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
