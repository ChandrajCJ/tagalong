import { sql } from 'drizzle-orm';
import { bigserial, check, index, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const syncSchema = pgSchema('sync');

/**
 * Append-only log of changes per trip. Offline clients ask for
 * "everything after seq N". Always write it in the same transaction
 * as the change itself.
 */
export const changeLog = syncSchema.table(
  'change_log',
  {
    seq: bigserial('seq', { mode: 'number' }).primaryKey(),
    tripId: uuid('trip_id').notNull(),
    entity: text('entity').notNull(),
    entityId: uuid('entity_id').notNull(),
    op: text('op').notNull(),
    changedBy: uuid('changed_by'),
    changedAt: timestamp('changed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('change_log_trip_seq_idx').on(t.tripId, t.seq),
    check('change_log_op_check', sql.raw(`op in ('upsert', 'delete')`)),
  ],
);
