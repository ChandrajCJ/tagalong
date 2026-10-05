import { createDb } from '@tagalong/db';
import { Redis } from 'ioredis';
import { loadEnv } from './env';
import { buildGateway } from './realtime/gateway';

const env = loadEnv();
const { db, close: closeDb } = createDb(env.DATABASE_URL, { max: 5 });
const redis = new Redis(env.REDIS_URL);
const subscriber = new Redis(env.REDIS_URL);

const app = await buildGateway({ env, db, redis, subscriber });

const shutdown = async () => {
  app.log.info('Gateway shutting down');
  await app.close();
  redis.disconnect();
  subscriber.disconnect();
  await closeDb();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ host: env.HOST, port: env.GATEWAY_PORT });
