import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  doublePrecision,
  index,
  integer,
  pgSchema,
  primaryKey,
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
    /**
     * Where it was added: the trip's album, a chat message (kept out of the
     * album unless someone adds it), the trip's cover photo, or a journal
     * entry (which is in the album too).
     */
    source: text('source').notNull().default('album'),
    /** A photo, or a short video whose poster frame the phone uploads as its thumbnail. */
    kind: text('kind').notNull().default('photo'),
    durationMs: integer('duration_ms'),
    version: version(),
    ...timestamps(),
    ...softDelete(),
  },
  (t) => [
    index('photos_trip_taken_idx').on(t.tripId, t.takenAt),
    index('photos_batch_idx').on(t.batchId),
    check('photos_status_check', sql.raw(`status in ('pending', 'ready')`)),
    check('photos_source_check', sql.raw(`source in ('album', 'chat', 'cover', 'journal')`)),
    // The server only stores what every phone and browser can show. iPhones'
    // HEIC is converted on the phone before upload.
    check(
      'photos_content_type_check',
      sql.raw(
        `content_type in ('image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime', 'video/webm')`,
      ),
    ),
    check('photos_kind_check', sql.raw(`kind in ('photo', 'video')`)),
    // At most a minute, so the free storage lasts.
    check('photos_video_check', sql.raw(`kind = 'photo' or (duration_ms is not null and duration_ms <= 60000)`)),
    // A location is both coordinates or neither, and inside the globe.
    check(
      'photos_location_check',
      sql.raw(
        `(latitude is null and longitude is null) or (latitude between -90 and 90 and longitude between -180 and 180)`,
      ),
    ),
  ],
);

/** Hearts. One per person per photo, so the count is always exact. */
export const photoFavourites = mediaSchema.table(
  'photo_favourites',
  {
    photoId: uuid('photo_id')
      .notNull()
      .references(() => photos.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.photoId, t.userId] })],
);
