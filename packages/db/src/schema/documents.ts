import { sql } from 'drizzle-orm';
import {
  bigint,
  char,
  check,
  index,
  jsonb,
  pgSchema,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { id, softDelete, timestamps, version } from './columns';
import { users } from './identity';
import { items, itinerarySchema } from './itinerary';
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

/**
 * A confirmed reservation: a flight, a stay, a table. It can sit on a plan
 * item and point at the document that proves it, but owns neither, so either
 * side can exist first.
 */
export const bookings = documentsSchema.table(
  'bookings',
  {
    id: id(),
    tripId: uuid('trip_id')
      .notNull()
      .references(() => trips.id, { onDelete: 'cascade' }),
    itemId: uuid('item_id').references(() => items.id, { onDelete: 'set null' }),
    documentId: uuid('document_id').references(() => documents.id, { onDelete: 'set null' }),
    type: text('type').notNull(),
    provider: text('provider'),
    reference: text('reference'),
    // Real instants. A flight leaves at a precise moment; "lunch at 13:00" doesn't.
    startsAt: timestamp('starts_at', { withTimezone: true }),
    endsAt: timestamp('ends_at', { withTimezone: true }),
    timezone: text('timezone').notNull().default('UTC'),
    /** The fields specific to the type, checked by its schema in @tagalong/shared. */
    details: jsonb('details').notNull().default({}),
    costMinor: bigint('cost_minor', { mode: 'number' }),
    costCurrency: char('cost_currency', { length: 3 }),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    version: version(),
    ...timestamps(),
    ...softDelete(),
  },
  (t) => [
    index('bookings_trip_starts_idx').on(t.tripId, t.startsAt),
    index('bookings_item_idx').on(t.itemId),
    check(
      'bookings_type_check',
      sql.raw(`type in ('flight', 'stay', 'train', 'ticket', 'car', 'restaurant')`),
    ),
  ],
);

/**
 * A confirmation email (forwarded, pasted, or read from a file) and the
 * bookings found in it, waiting for someone to review them. Imports never
 * become bookings on their own.
 */
export const bookingImports = itinerarySchema.table(
  'booking_imports',
  {
    id: id(),
    tripId: uuid('trip_id')
      .notNull()
      .references(() => trips.id, { onDelete: 'cascade' }),
    source: text('source').notNull(),
    /** Who pasted or forwarded it. */
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    fromAddress: text('from_address'),
    subject: text('subject'),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    status: text('status').notNull().default('pending'),
    /** What the parser found, each with whether it's been added or skipped. */
    candidates: jsonb('candidates').notNull().$type<unknown[]>().default([]),
    documentId: uuid('document_id').references(() => documents.id, { onDelete: 'set null' }),
    /** The email's Message-ID, so the same email forwarded twice is read once. */
    messageId: text('message_id').unique(),
    ...timestamps(),
  },
  (t) => [
    index('booking_imports_trip_idx').on(t.tripId, t.createdAt.desc()),
    check('booking_imports_source_check', sql.raw(`source in ('email', 'paste', 'document')`)),
    check('booking_imports_status_check', sql.raw(`status in ('pending', 'added', 'dismissed')`)),
  ],
);
