import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import { notificationPrefs, type Db } from '@tagalong/db';
import {
  DEFAULT_PREFS,
  UpdateNotificationPrefsInput,
  UpdateTripNotificationsInput,
  type NotificationKind,
  type NotificationPrefs,
  type TripNotifications,
} from '@tagalong/shared';
import type { z } from 'zod';
import { requireTripRole } from '../../lib/access';

type Row = typeof notificationPrefs.$inferSelect;
type UpdateDefaults = z.output<typeof UpdateNotificationPrefsInput>;
type UpdateTrip = z.output<typeof UpdateTripNotificationsInput>;

/** The switches a person can turn on and off, per trip or as defaults. */
type Kind = 'chat' | 'mentions' | 'plan' | 'money' | 'todos' | 'trip';

/** Defaults, then the trip's own choices on top; anything never set is on. */
const resolve = (defaults: Row | undefined, trip: Row | undefined): NotificationPrefs => {
  const pick = <K extends Kind>(k: K) => trip?.[k] ?? defaults?.[k] ?? DEFAULT_PREFS[k];
  const mutes = [defaults?.mutedUntil, trip?.mutedUntil].filter((d): d is Date => !!d);
  const latest = mutes.length ? new Date(Math.max(...mutes.map((d) => d.getTime()))) : null;
  return {
    chat: pick('chat'),
    mentions: pick('mentions'),
    plan: pick('plan'),
    money: pick('money'),
    todos: pick('todos'),
    trip: pick('trip'),
    reminders: defaults?.reminders ?? DEFAULT_PREFS.reminders,
    reminderMinutes: defaults?.reminderMinutes ?? DEFAULT_PREFS.reminderMinutes,
    mutedUntil: latest && latest.getTime() > Date.now() ? latest.toISOString() : null,
  };
};

/** Each person's settings as they apply on one trip, in one query. */
export const effectivePrefs = async (db: Db, userIds: string[], tripId: string) => {
  const result = new Map<string, NotificationPrefs>();
  if (userIds.length === 0) return result;
  const rows = await db
    .select()
    .from(notificationPrefs)
    .where(
      and(
        inArray(notificationPrefs.userId, userIds),
        or(isNull(notificationPrefs.tripId), eq(notificationPrefs.tripId, tripId)),
      ),
    );
  for (const userId of userIds) {
    const mine = rows.filter((r) => r.userId === userId);
    result.set(userId, resolve(mine.find((r) => r.tripId === null), mine.find((r) => r.tripId === tripId)));
  }
  return result;
};

/**
 * Whether a push of this kind should reach someone. Muting stops everything
 * except @mentions: being asked something directly gets through.
 */
export const wants = (prefs: NotificationPrefs, kind: NotificationKind, now = new Date()) => {
  if (!prefs[kind]) return false;
  if (kind !== 'mentions' && prefs.mutedUntil && new Date(prefs.mutedUntil) > now) return false;
  return true;
};

export const createNotificationsService = (db: Db) => {
  const rowFor = async (userId: string, tripId: string | null) =>
    (await db.select().from(notificationPrefs).where(which(userId, tripId)))[0];

  const which = (userId: string, tripId: string | null) =>
    and(eq(notificationPrefs.userId, userId), tripId ? eq(notificationPrefs.tripId, tripId) : isNull(notificationPrefs.tripId));

  /**
   * Updates the one row for (person, trip or defaults), or makes it. If two
   * saves race to make it, the unique index turns one away and it updates.
   */
  const save = async (userId: string, tripId: string | null, changes: Partial<Row>) => {
    if (Object.keys(changes).length === 0) return;
    const updated = await db.update(notificationPrefs).set(changes).where(which(userId, tripId)).returning({ id: notificationPrefs.id });
    if (updated.length > 0) return;
    try {
      await db.insert(notificationPrefs).values({ userId, tripId, ...changes });
    } catch {
      await db.update(notificationPrefs).set(changes).where(which(userId, tripId));
    }
  };

  const toDate = (iso: string | null | undefined) => (iso === undefined ? undefined : iso === null ? null : new Date(iso));

  return {
    /** Profile → Notifications. */
    async defaults(userId: string): Promise<NotificationPrefs> {
      return resolve(await rowFor(userId, null), undefined);
    },

    async updateDefaults(userId: string, input: UpdateDefaults) {
      const { mutedUntil, ...rest } = input;
      const changes = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)) as Partial<Row>;
      if (mutedUntil !== undefined) changes.mutedUntil = toDate(mutedUntil)!;
      await save(userId, null, changes);
      return this.defaults(userId);
    },

    /** The trip ⋯ menu → Notifications. */
    async forTrip(tripId: string, userId: string): Promise<TripNotifications> {
      await requireTripRole(db, tripId, userId, 'viewer');
      const [defaults, trip] = await Promise.all([rowFor(userId, null), rowFor(userId, tripId)]);
      return {
        effective: resolve(defaults, trip),
        overrides: {
          chat: trip?.chat ?? null,
          mentions: trip?.mentions ?? null,
          plan: trip?.plan ?? null,
          money: trip?.money ?? null,
          todos: trip?.todos ?? null,
          trip: trip?.trip ?? null,
          mutedUntil: trip?.mutedUntil && trip.mutedUntil.getTime() > Date.now() ? trip.mutedUntil.toISOString() : null,
        },
      };
    },

    async updateTrip(tripId: string, userId: string, input: UpdateTrip) {
      await requireTripRole(db, tripId, userId, 'viewer');
      const { mutedUntil, ...rest } = input;
      const changes = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)) as Partial<Row>;
      if (mutedUntil !== undefined) changes.mutedUntil = toDate(mutedUntil)!;
      await save(userId, tripId, changes);
      return this.forTrip(tripId, userId);
    },
  };
};
