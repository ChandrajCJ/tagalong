import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  doublePrecision,
  index,
  integer,
  pgSchema,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { id, softDelete, timestamps, version } from './columns';
import { users } from './identity';
import { trips } from './trips';

export const mediaSchema = pgSchema('media');

/**
 * One photo in the trip's shared album. The bytes live in object storage; the
 * thumbnail is made afterwards by the worker.
 */
export const photos = mediaSchema.table(
  'photos',
  {
    id: id(),
    tripId: uuid('trip_id')
      .notNull()
      .references(() => trips.id, { onDelete: 'cascade' }),
    uploadedBy: uuid('uploaded_by')
      .notNull()
      .references(() => users.id),
    /** Photos picked together share a batch, so the chat gets one card, not forty. */
    batchId: uuid('batch_id').notNull(),
    storageKey: text('storage_key').notNull(),
    /** Set by the worker once the thumbnail exists. */
    thumbKey: text('thumb_key'),
    contentType: text('content_type').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }),
    width: integer('width'),
    height: integer('height'),
    /*
     * When the photo was taken, as the clock read where it was taken, with no
     * timezone on purpose. A sunset shot at 18:30 in Lisbon belongs to that
     * Lisbon evening wherever it's viewed from later, and that's also what
     * the camera records. Read as a string so nothing converts it.
     */
    takenAt: timestamp('taken_at', { mode: 'string' }),
    latitude: doublePrecision('latitude'),
    longitude: doublePrecision('longitude'),
    status: text('status').notNull().default('pending'),
    caption: text('caption'),
    version: version(),
    ...timestamps(),
    ...softDelete(),
  },
  (t) => [
    index('photos_trip_taken_idx').on(t.tripId, t.takenAt),
    index('photos_batch_idx').on(t.batchId),
    check('photos_status_check', sql.raw(`status in ('pending', 'ready')`)),
    // The server only stores what every phone and browser can show. iPhones'
    // HEIC is converted on the phone before upload.
    check(
      'photos_content_type_check',
      sql.raw(`content_type in ('image/jpeg', 'image/png', 'image/webp')`),
    ),
    // A location is both coordinates or neither, and inside the globe.
    check(
      'photos_location_check',
      sql.raw(
        `(latitude is null and longitude is null) or (latitude between -90 and 90 and longitude between -180 and 180)`,
      ),
    ),
  ],
);
