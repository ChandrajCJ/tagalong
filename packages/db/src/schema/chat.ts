import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { id } from './columns';
import { users } from './identity';
import { items } from './itinerary';
import { trips } from './trips';

export const chatSchema = pgSchema('chat');

/** A trip's main conversation, and later one thread per plan item. */
export const channels = chatSchema.table(
  'channels',
  {
    id: id(),
    tripId: uuid('trip_id')
      .notNull()
      .references(() => trips.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull().default('trip'),
    itemId: uuid('item_id').references(() => items.id, { onDelete: 'cascade' }),
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('channels_kind_check', sql.raw(`kind in ('trip', 'item')`)),
    // Exactly one main channel per trip.
    uniqueIndex('channels_one_main_per_trip').on(t.tripId).where(sql.raw(`kind = 'trip'`)),
    // And one thread per plan item, for the same reason.
    uniqueIndex('channels_one_thread_per_item').on(t.itemId).where(sql.raw(`kind = 'item'`)),
  ],
);

export const messages = chatSchema.table(
  'messages',
  {
    // Generated on the phone, so a resend can't create a duplicate.
    id: uuid('id').primaryKey(),
    channelId: uuid('channel_id')
      .notNull()
      .references(() => channels.id, { onDelete: 'cascade' }),
    tripId: uuid('trip_id')
      .notNull()
      .references(() => trips.id, { onDelete: 'cascade' }),
    // null for system messages ("Maya joined the trip").
    senderId: uuid('sender_id').references(() => users.id, { onDelete: 'set null' }),
    kind: text('kind').notNull().default('text'),
    body: text('body').notNull(),
    replyToId: uuid('reply_to_id'),
    payload: jsonb('payload'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    editedAt: timestamp('edited_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    index('messages_channel_recent_idx').on(t.channelId, t.createdAt.desc(), t.id.desc()),
    check('messages_kind_check', sql.raw(`kind in ('text', 'system', 'poll')`)),
    // One "Riya added 40 photos" card per upload batch, guaranteed by the
    // database rather than by timing: a double tap can't post two.
    uniqueIndex('messages_one_card_per_photo_batch')
      .on(sql`(${t.payload}->>'batchId')`)
      .where(sql.raw(`kind = 'system' and payload ? 'batchId'`)),
  ],
);

/**
 * A question asked in the chat. It hangs off a message, so it appears in the
 * conversation where the decision is actually being made.
 */
export const polls = chatSchema.table('polls', {
  id: id(),
  messageId: uuid('message_id')
    .notNull()
    .unique()
    .references(() => messages.id, { onDelete: 'cascade' }),
  tripId: uuid('trip_id')
    .notNull()
    .references(() => trips.id, { onDelete: 'cascade' }),
  question: text('question').notNull(),
  /** Whether people may pick more than one option. */
  multi: boolean('multi').notNull().default(false),
  closedAt: timestamp('closed_at', { withTimezone: true }),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const pollOptions = chatSchema.table(
  'poll_options',
  {
    id: id(),
    pollId: uuid('poll_id')
      .notNull()
      .references(() => polls.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    position: integer('position').notNull(),
    /** The plan item this option became, once someone added it to the plan. */
    itemId: uuid('item_id').references(() => items.id, { onDelete: 'set null' }),
  },
  (t) => [index('poll_options_poll_idx').on(t.pollId, t.position)],
);

/** `poll_id` is carried here too, so replacing a single-choice vote is one delete. */
export const pollVotes = chatSchema.table(
  'poll_votes',
  {
    optionId: uuid('option_id')
      .notNull()
      .references(() => pollOptions.id, { onDelete: 'cascade' }),
    pollId: uuid('poll_id')
      .notNull()
      .references(() => polls.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.optionId, t.userId] }),
    index('poll_votes_poll_idx').on(t.pollId, t.userId),
  ],
);

export const reactions = chatSchema.table(
  'reactions',
  {
    messageId: uuid('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    emoji: text('emoji').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.messageId, t.userId, t.emoji] })],
);

/** One row per person per channel: how far they've read. Not one row per message. */
export const readStates = chatSchema.table(
  'read_states',
  {
    channelId: uuid('channel_id')
      .notNull()
      .references(() => channels.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    lastReadMessageId: uuid('last_read_message_id'),
    lastReadAt: timestamp('last_read_at', { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.channelId, t.userId] })],
);
