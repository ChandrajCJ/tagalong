import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createDb } from './client';

const defaultFolder = fileURLToPath(new URL('../migrations', import.meta.url));

/** Any fixed number: everyone migrating takes the same lock. */
const MIGRATION_LOCK = 7_310_016;

/**
 * Applies all pending migrations to the database at `url`. A Postgres
 * advisory lock makes servers that start together take turns, so only the
 * first one migrates. Use a direct connection, not a pooler: the lock belongs
 * to one session. `folder` is for bundled builds, where this file has moved.
 */
export const runMigrations = async (url: string, { folder = defaultFolder }: { folder?: string } = {}) => {
  const { db, close } = createDb(url, { max: 1 });
  try {
    await db.execute(sql`select pg_advisory_lock(${MIGRATION_LOCK})`);
    try {
      await migrate(db, { migrationsFolder: folder });
    } finally {
      await db.execute(sql`select pg_advisory_unlock(${MIGRATION_LOCK})`);
    }
  } finally {
    await close();
  }
};
