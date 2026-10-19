import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

/**
 * Connection poolers in transaction mode (Neon's "-pooler" hosts, PgBouncer)
 * hand each query to whichever server connection is free, so a statement
 * prepared on one may not exist on the next.
 */
export const isPooledUrl = (url: string) => {
  try {
    const { hostname, searchParams } = new URL(url);
    return hostname.includes('-pooler') || searchParams.get('pgbouncer') === 'true';
  } catch {
    return false;
  }
};

export const createDb = (url: string, options: { max?: number } = {}) => {
  const sql = postgres(url, {
    max: options.max ?? 10,
    onnotice: () => {},
    prepare: !isPooledUrl(url),
  });
  const db = drizzle(sql, { schema, casing: 'snake_case' });
  return { db, sql, close: () => sql.end({ timeout: 5 }) };
};

export type Db = ReturnType<typeof createDb>['db'];
/** A db handle or an open transaction; both run queries the same way. */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
