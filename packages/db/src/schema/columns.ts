import { integer, timestamp, uuid } from 'drizzle-orm/pg-core';
import { newId } from '@tagalong/shared';

// Shared column helpers so every table follows the same conventions.

export const id = () =>
  uuid('id')
    .primaryKey()
    .$defaultFn(() => newId());

export const timestamps = () => ({
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const softDelete = () => ({
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const version = () => integer('version').notNull().default(1);
