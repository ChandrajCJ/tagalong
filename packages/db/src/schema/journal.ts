import { sql } from 'drizzle-orm';
import {
  check,
  date,
  doublePrecision,
  index,
  jsonb,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { messages } from './chat';
import { id, softDelete, timestamps, version } from './columns';
import { users } from './identity';
import { trips } from './trips';

export const journalSchema = pgSchema('journal');

/**
 * One entry on a day of the trip journal: a note someone wrote, or a quote
 * saved from the chat. A private entry is only ever read by its author: every
 * query filters on `visibility = 'group' or author_id = me`.
 */
export const journalEntries = journalSchema.table(
  'entries',
  {
    id: id(),
    tripId: uuid('trip_id')
      .notNull()
      .references(() => trips.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id),
    /** The trip day it belongs to, a local date like a plan item's. */
    date: date('date', { mode: 'string' }).notNull(),
    kind: text('kind').notNull().default('note'),
    body: text('body').notNull(),
    mood: text('mood'),
    visibility: text('visibility').notNull().default('group'),
    /** Photos and videos from the trip's album, in the order picked. */
    mediaIds: uuid('media_ids').array().notNull().default(sql`'{}'::uuid[]`),
    placeLabel: text('place_label'),
    latitude: doublePrecision('latitude'),
    longitude: doublePrecision('longitude'),
    placeRef: text('place_ref'),
    /** For a quote: the chat message it was saved from. */
    sourceMessageId: uuid('source_message_id').references(() => messages.id, { onDelete: 'set null' }),
    version: version(),
    ...timestamps(),
    ...softDelete(),
  },
  (t) => [
    index('journal_entries_trip_date_idx').on(t.tripId, t.date),
    // Saving the same message twice gives back the same quote.
    uniqueIndex('journal_entries_quote_idx')
      .on(t.sourceMessageId, t.authorId)
      .where(sql`source_message_id is not null`),
    check('journal_entries_kind_check', sql.raw(`kind in ('note', 'quote')`)),
    check('journal_entries_visibility_check', sql.raw(`visibility in ('group', 'private')`)),
    check(
      'journal_entries_location_check',
      sql.raw(`(latitude is null and longitude is null) or (latitude between -90 and 90 and longitude between -180 and 180)`),
    ),
  ],
);

/** The same emoji as chat reactions, one row per person per emoji. Group entries only. */
export const journalReactions = journalSchema.table(
  'reactions',
  {
    entryId: uuid('entry_id')
      .notNull()
      .references(() => journalEntries.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    emoji: text('emoji').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.entryId, t.userId, t.emoji] })],
);

/** Short replies under a group entry. */
export const journalComments = journalSchema.table(
  'comments',
  {
    id: id(),
    entryId: uuid('entry_id')
      .notNull()
      .references(() => journalEntries.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id),
    body: text('body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    ...softDelete(),
  },
  (t) => [index('journal_comments_entry_idx').on(t.entryId, t.createdAt)],
);

/**
 * Journal pushes already sent, so each goes once: the evening prompt per
 * day ('prompt'), "On this day" per day ('memory'), and the recap ('recap').
 */
export const journalPushesSent = journalSchema.table(
  'pushes_sent',
  {
    tripId: uuid('trip_id')
      .notNull()
      .references(() => trips.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    /** The day it was about: the trip day, or today for a memory. */
    day: date('day', { mode: 'string' }).notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.tripId, t.userId, t.kind, t.day] }),
    check('journal_pushes_sent_kind_check', sql.raw(`kind in ('prompt', 'memory', 'recap')`)),
  ],
);

/**
 * The end-of-trip recap's numbers, worked out once the trip is over and kept
 * until something on the trip changes (`stamp` no longer matches). Group
 * entries only, so it's the same for every member.
 */
export const journalRecaps = journalSchema.table('recaps', {
  tripId: uuid('trip_id')
    .primaryKey()
    .references(() => trips.id, { onDelete: 'cascade' }),
  stamp: text('stamp').notNull(),
  data: jsonb('data').notNull(),
  computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
});
