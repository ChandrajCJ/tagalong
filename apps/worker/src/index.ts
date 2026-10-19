import { s3Storage, startWorkers } from '@tagalong/api/jobs';
import { createDb } from '@tagalong/db';
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

const workers = await startWorkers({
  db,
  redis,
  connection,
  storage: s3Storage(env),
  log,
  imapUrl: env.IMPORT_IMAP_URL,
  importAddress: env.IMPORT_ADDRESS,
  authservId: env.IMPORT_AUTHSERV_ID,
});

const shutdown = async () => {
  await workers.close();
  connection.disconnect();
  redis.disconnect();
  await closeDb();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
