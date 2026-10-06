import { createDb } from '@tagalong/db';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { buildApp } from './app';
import { loadEnv } from './env';
import { ensureBucket } from './lib/storage';

const env = loadEnv();
const { db, close: closeDb } = createDb(env.DATABASE_URL);
const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });

await ensureBucket(env);
const app = await buildApp({ env, db, redis });

// Prove the API → queue → worker path on every start.
const systemQueue = new Queue('system', { connection: redis });
await systemQueue.add('ping', { from: 'api', at: new Date().toISOString() });

const shutdown = async () => {
  app.log.info('Shutting down');
  await app.close();
  await systemQueue.close();
  redis.disconnect();
  await closeDb();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ host: env.HOST, port: env.PORT });
