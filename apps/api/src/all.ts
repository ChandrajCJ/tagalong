import { fileURLToPath } from 'node:url';
import { createDb, runMigrations } from '@tagalong/db';
import { Redis } from 'ioredis';
import { buildCombined } from './combined';
import { loadEnv } from './env';
import { startWorkers } from './jobs/workers';
import { startKeepAwake } from './lib/keep-awake';
import { ensureBucket, s3Storage } from './lib/storage';

/**
 * Everything in one process: migrations, then the API with the realtime
 * gateway at /ws, and the background workers. For a host that gives one free
 * server (Render's free plan, docs/DEPLOY-FREE.md). The Docker setup and
 * development run server.ts, gateway.ts and apps/worker separately instead.
 */
const env = loadEnv();

// Same depth from src/ (tsx) and dist/ (the bundle), so one path works for both.
const migrationsFolder = fileURLToPath(new URL('../../../packages/db/migrations', import.meta.url));
await runMigrations(env.DATABASE_DIRECT_URL ?? env.DATABASE_URL, { folder: migrationsFolder });

const { db, close: closeDb } = createDb(env.DATABASE_URL);
const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
const subscriber = new Redis(env.REDIS_URL);
const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
await ensureBucket(env);
const storage = s3Storage(env);

const app = await buildCombined({ env, db, redis, subscriber, storage });
const workers = await startWorkers({
  db,
  redis,
  connection,
  storage,
  log: app.log,
  imapUrl: env.IMPORT_IMAP_URL,
  importAddress: env.IMPORT_ADDRESS,
  authservId: env.IMPORT_AUTHSERV_ID,
  ownHosts: (env.CORS_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean)
    .flatMap((o) => {
      try {
        return [new URL(o).hostname];
      } catch {
        return [];
      }
    }),
});

// Stay awake on Render's free plan (see lib/keep-awake.ts). Off elsewhere.
const stopKeepAwake = startKeepAwake(process.env.RENDER_EXTERNAL_URL, app.log);

const shutdown = async () => {
  app.log.info('Shutting down');
  stopKeepAwake();
  await app.close();
  await workers.close();
  for (const client of [redis, subscriber, connection]) client.disconnect();
  await closeDb();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ host: env.HOST, port: env.PORT });
