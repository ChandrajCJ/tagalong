import { sql } from 'drizzle-orm';
import {
  bigint,
  char,
  check,
  date,
  index,
  pgSchema,
  primaryKey,
  text,
  time,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { id, softDelete, timestamps, version } from './columns';
import { users } from './identity';
import { trips } from './trips';

export const itinerarySchema = pgSchema('itinerary');

/** Optional title and notes for a day ("Sintra day"). */
export const tripDays = itinerarySchema.table(
  'trip_days',
  {
    id: id(),
    tripId: uuid('trip_id')
      .notNull()
      .references(() => trips.id, { onDelete: 'cascade' }),
    date: date('date', { mode: 'string' }).notNull(),
    title: text('title'),
    notes: text('notes'),
    version: version(),
    ...timestamps(),
  },
  (t) => [unique('trip_days_trip_date').on(t.tripId, t.date)],
);

/** One thing in the plan: an activity, meal, flight, stay... */
export const items = itinerarySchema.table(
  'items',
  {
    id: id(),
    tripId: uuid('trip_id')
      .notNull()
      .references(() => trips.id, { onDelete: 'cascade' }),
    // null = "Anytime": not on a specific day yet.
    date: date('date', { mode: 'string' }),
    startTime: time('start_time'),
    endTime: time('end_time'),
    // A fractional-index key: sorting these strings gives the order within a day.
    position: text('position').notNull(),
    type: text('type').notNull().default('activity'),
    title: text('title').notNull(),
    notes: text('notes'),
    placeName: text('place_name'),
    costEstimateMinor: bigint('cost_estimate_minor', { mode: 'number' }),
    costCurrency: char('cost_currency', { length: 3 }),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    version: version(),
    ...timestamps(),
    ...softDelete(),
  },
  (t) => [
    index('items_trip_date_position_idx').on(t.tripId, t.date, t.position),
    check(
      'items_type_check',
      sql.raw(`type in ('activity', 'meal', 'transport', 'stay', 'flight', 'other')`),
    ),
  ],
);

export const itemAssignees = itinerarySchema.table(
  'item_assignees',
  {
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.itemId, t.userId] })],
);
