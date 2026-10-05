import type { Db } from '@tagalong/db';
import type { Redis } from 'ioredis';
import type { Env } from './env';
import type { Jobs } from './lib/jobs';
import type { Mailer } from './lib/mailer';

/** Everything route modules need, passed in so tests can swap pieces. */
export interface Deps {
  env: Env;
  db: Db;
  redis: Redis;
  mailer: Mailer;
  jobs: Jobs;
}
