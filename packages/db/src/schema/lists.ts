import { sql } from 'drizzle-orm';
import { boolean, check, date, index, pgSchema, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { id, softDelete, timestamps, version } from './columns';
import { users } from './identity';
import { items } from './itinerary';
import { trips } from './trips';

export const listsSchema = pgSchema('lists');

/** A checklist for the trip: packing, or things to do before you go. */
export const lists = listsSchema.table(
  'lists',
  {
    id: id(),
    tripId: uuid('trip_id')
      .notNull()
      .references(() => trips.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    kind: text('kind').notNull(),
    /** A fractional-index key, like a plan item's: sorting gives the order. */
    position: text('position').notNull(),
    version: version(),
    ...timestamps(),
    ...softDelete(),
  },
  (t) => [
    index('lists_trip_idx').on(t.tripId),
    check('lists_kind_check', sql.raw(`kind in ('packing', 'todo')`)),
  ],
);

/**
 * One line on a list. "shared" lines get one tick for the group
 * ("First-aid kit"); "everyone" lines are ticked by each person for
 * themselves ("Passport"), in `list_item_checks`.
 */
export const listItems = listsSchema.table(
  'list_items',
  {
    id: id(),
    listId: uuid('list_id')
      .notNull()
      .references(() => lists.id, { onDelete: 'cascade' }),
    tripId: uuid('trip_id')
      .notNull()
      .references(() => trips.id, { onDelete: 'cascade' }),
    text: text('text').notNull(),
    scope: text('scope').notNull().default('shared'),
    /** "Sam's bringing it" / "Sam's doing it". */
    assigneeId: uuid('assignee_id').references(() => users.id, { onDelete: 'set null' }),
    dueDate: date('due_date', { mode: 'string' }),
    /** The plan item this is about ("Book Sintra tickets" → the Sintra item). */
    itemId: uuid('item_id').references(() => items.id, { onDelete: 'set null' }),
    /** The shared tick. Unused for "everyone" lines. */
    doneBy: uuid('done_by').references(() => users.id, { onDelete: 'set null' }),
    doneAt: timestamp('done_at', { withTimezone: true }),
    position: text('position').notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    version: version(),
    ...timestamps(),
    ...softDelete(),
  },
  (t) => [
    index('list_items_trip_idx').on(t.tripId),
    index('list_items_list_idx').on(t.listId),
    index('list_items_item_idx').on(t.itemId),
    check('list_items_scope_check', sql.raw(`scope in ('shared', 'everyone')`)),
  ],
);

/** Each person's own tick on an "everyone" line. */
export const listItemChecks = listsSchema.table(
  'list_item_checks',
  {
    listItemId: uuid('list_item_id')
      .notNull()
      .references(() => listItems.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    checkedAt: timestamp('checked_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.listItemId, t.userId] })],
);

/** A trip note: "Emergency numbers", "Wi-Fi codes". Plain text; edits are version-checked. */
export const notes = listsSchema.table(
  'notes',
  {
    id: id(),
    tripId: uuid('trip_id')
      .notNull()
      .references(() => trips.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    body: text('body').notNull().default(''),
    pinned: boolean('pinned').notNull().default(false),
    updatedBy: uuid('updated_by')
      .notNull()
      .references(() => users.id),
    version: version(),
    ...timestamps(),
    ...softDelete(),
  },
  (t) => [
    index('notes_trip_idx').on(t.tripId),
    check('notes_body_length_check', sql.raw(`char_length(body) <= 20000`)),
  ],
);
