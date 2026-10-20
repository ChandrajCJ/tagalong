import { sql } from 'drizzle-orm';
import { boolean, integer, primaryKey, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { id } from './columns';
import { identity, users } from './identity';
import { trips } from './trips';

/**
 * What someone wants to be told about. The row with no trip holds their
 * defaults; a row for a trip overrides them there, where null means "as my
 * defaults". No row at all means everything on.
 */
export const notificationPrefs = identity.table(
  'notification_prefs',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tripId: uuid('trip_id').references(() => trips.id, { onDelete: 'cascade' }),
    chat: boolean('chat'),
    mentions: boolean('mentions'),
    plan: boolean('plan'),
    money: boolean('money'),
    todos: boolean('todos'),
    trip: boolean('trip'),
    /** The countdown before a trip: a week, three days, the evening before, the morning of. */
    countdown: boolean('countdown'),
    /** Reminders before timed stops, which the phone schedules itself. Defaults row only. */
    reminders: boolean('reminders'),
    reminderMinutes: integer('reminder_minutes'),
    /** Only @mentions get through until then. */
    mutedUntil: timestamp('muted_until', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    // One defaults row and one row per trip, per person.
    uniqueIndex('notification_prefs_user_trip_idx').on(
      t.userId,
      sql`coalesce(${t.tripId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
    ),
  ],
);

/** Each countdown push goes once per trip and person: "week", "three", "eve", "day". */
export const countdownSent = identity.table(
  'countdown_sent',
  {
    tripId: uuid('trip_id')
      .notNull()
      .references(() => trips.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    stage: text('stage').notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.tripId, t.userId, t.stage] })],
);
