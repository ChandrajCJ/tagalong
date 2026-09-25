import { sql } from 'drizzle-orm';
import {
  boolean,
  char,
  check,
  index,
  integer,
  pgSchema,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { id, softDelete, timestamps } from './columns';

export const identity = pgSchema('identity');

export const users = identity.table(
  'users',
  {
    id: id(),
    email: text('email').notNull(),
    displayName: text('display_name').notNull(),
    avatarKey: text('avatar_key'),
    homeCurrency: char('home_currency', { length: 3 }).notNull().default('EUR'),
    locale: text('locale'),
    timezone: text('timezone'),
    faceGroupingConsent: boolean('face_grouping_consent').notNull().default(false),
    ...timestamps(),
    ...softDelete(),
  },
  (t) => [uniqueIndex('users_email_lower_idx').on(sql`lower(${t.email})`)],
);

export const authIdentities = identity.table(
  'auth_identities',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    providerUserId: text('provider_user_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('auth_identities_provider_uid').on(t.provider, t.providerUserId),
    check('auth_identities_provider_check', sql.raw(`provider in ('email', 'apple', 'google')`)),
  ],
);

export const devices = identity.table(
  'devices',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name'),
    platform: text('platform'),
    pushToken: text('push_token'),
    appVersion: text('app_version'),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('devices_user_idx').on(t.userId)],
);

export const sessions = identity.table(
  'sessions',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    deviceId: uuid('device_id').references(() => devices.id, { onDelete: 'set null' }),
    refreshTokenHash: text('refresh_token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

/** One-time sign-in codes for email login. Only the hash is stored. */
export const loginCodes = identity.table(
  'login_codes',
  {
    id: id(),
    email: text('email').notNull(),
    codeHash: text('code_hash').notNull(),
    attempts: integer('attempts').notNull().default(0),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('login_codes_email_idx').on(t.email, t.createdAt)],
);
