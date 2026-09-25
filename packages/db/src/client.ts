import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export const createDb = (url: string, options: { max?: number } = {}) => {
  const sql = postgres(url, { max: options.max ?? 10, onnotice: () => {} });
  const db = drizzle(sql, { schema, casing: 'snake_case' });
  return { db, sql, close: () => sql.end({ timeout: 5 }) };
};

export type Db = ReturnType<typeof createDb>['db'];
/** A db handle or an open transaction; both run queries the same way. */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
