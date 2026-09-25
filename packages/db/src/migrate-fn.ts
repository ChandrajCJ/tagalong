import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createDb } from './client';

const migrationsFolder = fileURLToPath(new URL('../migrations', import.meta.url));

/** Applies all pending migrations to the database at `url`. */
export const runMigrations = async (url: string) => {
  const { db, close } = createDb(url, { max: 1 });
  try {
    await migrate(db, { migrationsFolder });
  } finally {
    await close();
  }
};
