import { sql } from 'drizzle-orm';
import {
  bigint,
  char,
  check,
  date,
  index,
  numeric,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { messages } from './chat';
import { id, softDelete, timestamps, version } from './columns';
import { bookings } from './documents';
import { users } from './identity';
import { items } from './itinerary';
import { trips } from './trips';

export const expensesSchema = pgSchema('expenses');

/**
 * Something one person paid for the group. Balances are never stored: they're
 * worked out from these rows and settlements every time, so they can't drift.
 */
export const expenses = expensesSchema.table(
  'expenses',
  {
    id: id(),
    tripId: uuid('trip_id')
      .notNull()
      .references(() => trips.id, { onDelete: 'cascade' }),
    paidBy: uuid('paid_by')
      .notNull()
      .references(() => users.id),
    description: text('description').notNull(),
    category: text('category').notNull().default('other'),
    /** What was paid, in the currency it was paid in. */
    amountMinor: bigint('amount_minor', { mode: 'number' }).notNull(),
    currency: char('currency', { length: 3 }).notNull(),
    /**
     * 1 unit of `currency` in the trip's currency, frozen when the expense is
     * logged, so balances don't move when exchange rates do.
     */
    fxRate: numeric('fx_rate', { precision: 18, scale: 8 }).notNull(),
    /** The amount in the trip's currency, which the splits add up to exactly. */
    baseAmountMinor: bigint('base_amount_minor', { mode: 'number' }).notNull(),
    /** The trip day it belongs to: a local date, like a plan item's. */
    spentOn: date('spent_on', { mode: 'string' }).notNull(),
    splitMethod: text('split_method').notNull(),
    itemId: uuid('item_id').references(() => items.id, { onDelete: 'set null' }),
    bookingId: uuid('booking_id').references(() => bookings.id, { onDelete: 'set null' }),
    sourceMessageId: uuid('source_message_id').references(() => messages.id, { onDelete: 'set null' }),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    version: version(),
    ...timestamps(),
    ...softDelete(),
  },
  (t) => [
    index('expenses_trip_spent_idx').on(t.tripId, t.spentOn),
    index('expenses_booking_idx').on(t.bookingId),
    check('expenses_amount_check', sql.raw(`amount_minor > 0 and base_amount_minor >= 0`)),
    check('expenses_rate_check', sql.raw(`fx_rate > 0`)),
    check(
      'expenses_category_check',
      sql.raw(`category in ('food', 'transport', 'stay', 'activity', 'shopping', 'other')`),
    ),
    check(
      'expenses_split_method_check',
      sql.raw(`split_method in ('equal', 'exact', 'percent', 'shares')`),
    ),
  ],
);

/**
 * Each person's part of an expense, in the trip's currency. `value` is what
 * was entered for them (a share count, basis points or an exact amount), kept
 * so the split can be shown and edited the way it was made.
 */
export const expenseSplits = expensesSchema.table(
  'expense_splits',
  {
    expenseId: uuid('expense_id')
      .notNull()
      .references(() => expenses.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    value: bigint('value', { mode: 'number' }).notNull(),
    shareMinor: bigint('share_minor', { mode: 'number' }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.expenseId, t.userId] }),
    index('expense_splits_user_idx').on(t.userId),
    check('expense_splits_share_check', sql.raw(`share_minor >= 0 and value >= 0`)),
  ],
);

/** "Sam paid Alex back": money between two people, in the trip's currency. */
export const settlements = expensesSchema.table(
  'settlements',
  {
    id: id(),
    tripId: uuid('trip_id')
      .notNull()
      .references(() => trips.id, { onDelete: 'cascade' }),
    fromUser: uuid('from_user')
      .notNull()
      .references(() => users.id),
    toUser: uuid('to_user')
      .notNull()
      .references(() => users.id),
    amountMinor: bigint('amount_minor', { mode: 'number' }).notNull(),
    method: text('method').notNull().default('cash'),
    note: text('note'),
    settledAt: timestamp('settled_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    version: version(),
    ...timestamps(),
    ...softDelete(),
  },
  (t) => [
    index('settlements_trip_idx').on(t.tripId, t.settledAt),
    check('settlements_amount_check', sql.raw(`amount_minor > 0`)),
    check('settlements_people_check', sql.raw(`from_user <> to_user`)),
    check('settlements_method_check', sql.raw(`method in ('cash', 'transfer', 'other')`)),
  ],
);
