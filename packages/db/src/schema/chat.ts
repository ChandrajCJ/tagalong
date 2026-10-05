import { sql } from 'drizzle-orm';
import {
  check,
  index,
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
    check('messages_kind_check', sql.raw(`kind in ('text', 'system')`)),
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
