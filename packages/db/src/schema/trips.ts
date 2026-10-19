import { sql } from 'drizzle-orm';
import {
  char,
  check,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { id, softDelete, timestamps, version } from './columns';
import { users } from './identity';

export const tripsSchema = pgSchema('trips');

// Unqualified column names: Drizzle would otherwise schema-qualify them inside CHECK.
const roleCheck = () => sql.raw(`role in ('owner', 'editor', 'viewer')`);

export const trips = tripsSchema.table('trips', {
  id: id(),
  name: text('name').notNull(),
  destination: text('destination').notNull(),
  startDate: date('start_date', { mode: 'string' }),
  endDate: date('end_date', { mode: 'string' }),
  timezone: text('timezone'),
  /** Set when someone picked a real place for the destination, so maps, weather and tips work. */
  placeId: text('place_id'),
  latitude: doublePrecision('latitude'),
  longitude: doublePrecision('longitude'),
  /** [west, south, east, north] of the destination, when the search gave an area. */
  bounds: jsonb('bounds').$type<[number, number, number, number]>(),
  countryCode: char('country_code', { length: 2 }),
  baseCurrency: char('base_currency', { length: 3 }).notNull().default('EUR'),
  coverColor: text('cover_color').notNull().default('#D8A47F'),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id),
  publicSlug: text('public_slug').unique(),
  /**
   * The "+code" in the trip's forwarding address (tagalong.inbox+code@gmail.com).
   * Random, made the first time someone asks for the address; the owner can change it.
   */
  inboxCode: text('inbox_code').unique(),
  version: version(),
  ...timestamps(),
  ...softDelete(),
});

/** Every permission check in the app goes through this table. */
export const tripMembers = tripsSchema.table(
  'trip_members',
  {
    tripId: uuid('trip_id')
      .notNull()
      .references(() => trips.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
    leftAt: timestamp('left_at', { withTimezone: true }),
    /** Set when an owner removed them, so an old invite link can't bring them back. */
    removedBy: uuid('removed_by').references(() => users.id, { onDelete: 'set null' }),
    /** Set when this person archived the trip. Only hides it from their own list. */
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.tripId, t.userId] }),
    index('trip_members_user_idx').on(t.userId),
    check('trip_members_role_check', roleCheck()),
  ],
);

export const invites = tripsSchema.table(
  'invites',
  {
    id: id(),
    tripId: uuid('trip_id')
      .notNull()
      .references(() => trips.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    role: text('role').notNull().default('editor'),
    invitedEmail: text('invited_email'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    // One link can invite a whole group. null = unlimited until it expires.
    maxUses: integer('max_uses'),
    useCount: integer('use_count').notNull().default(0),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    acceptedBy: uuid('accepted_by').references(() => users.id),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('invites_trip_idx').on(t.tripId),
    check('invites_role_check', roleCheck()),
  ],
);
