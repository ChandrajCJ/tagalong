import { sql } from 'drizzle-orm';
import { bigint, check, index, pgSchema, text, uuid } from 'drizzle-orm/pg-core';
import { id, softDelete, timestamps, version } from './columns';
import { users } from './identity';
import { trips } from './trips';

export const documentsSchema = pgSchema('documents');

/**
 * A file belonging to a trip: a ticket, a booking confirmation, a screenshot.
 * The bytes live in object storage; this row is everything we know about them.
 */
export const documents = documentsSchema.table(
  'documents',
  {
    id: id(),
    tripId: uuid('trip_id')
      .notNull()
      .references(() => trips.id, { onDelete: 'cascade' }),
    uploadedBy: uuid('uploaded_by')
      .notNull()
      .references(() => users.id),
    kind: text('kind').notNull().default('other'),
    name: text('name').notNull(),
    /** Where the bytes are in the bucket. Never shown to anyone. */
    storageKey: text('storage_key').notNull(),
    contentType: text('content_type').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }),
    /**
     * `pending` until the phone confirms the upload and we've seen the object.
     * A half-finished upload leaves a pending row, never a broken document.
     */
    status: text('status').notNull().default('pending'),
    thumbnailKey: text('thumbnail_key'),
    version: version(),
    ...timestamps(),
    ...softDelete(),
  },
  (t) => [
    index('documents_trip_idx').on(t.tripId, t.createdAt.desc()),
    check('documents_kind_check', sql.raw(`kind in ('flight', 'stay', 'ticket', 'other')`)),
    check('documents_status_check', sql.raw(`status in ('pending', 'ready')`)),
  ],
);
