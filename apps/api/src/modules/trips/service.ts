import { and, asc, desc, eq, gt, isNotNull, isNull, sql } from 'drizzle-orm';
import { changeLog, expenses, tripMembers, trips, users, type Db } from '@tagalong/db';
import {
  CreateTripInput,
  newId,
  TRIP_RESTORE_DAYS,
  UpdateTripInput,
  type DeletedTrip,
  type MyTrips,
  type Trip,
  type TripLocation,
  type TripRole,
  type TripSummary,
} from '@tagalong/shared';
import type { Redis } from 'ioredis';
import type { z } from 'zod';
import { requireTripRole } from '../../lib/access';
import { badRequest, conflict, notFound } from '../../lib/errors';
import { publishTripEvent } from '../../lib/events';
import type { Geo } from '../../lib/geo';
import { postSystemMessage, unreadCounts } from '../chat/channel';

type CreateTrip = z.output<typeof CreateTripInput>;
type UpdateTrip = z.output<typeof UpdateTripInput>;

const activeMemberCount = sql<number>`(
  select count(*)::int from ${tripMembers} m
  where m.trip_id = ${trips.id} and m.left_at is null
)`;

const RESTORE_MS = TRIP_RESTORE_DAYS * 24 * 60 * 60 * 1000;

/** Whether this person is still on the trip, deleted or not. */
const memberOf = (tripId: string, userId: string) =>
  and(eq(tripMembers.tripId, tripId), eq(tripMembers.userId, userId), isNull(tripMembers.leftAt));

export const createTripsService = (db: Db, redis?: Redis, geo?: Geo) => {
  /** The columns for a picked place, with its time zone looked up (best effort). */
  const locationColumns = async (location: TripLocation) => ({
    placeId: location.placeId,
    latitude: location.latitude,
    longitude: location.longitude,
    bounds: location.bounds,
    countryCode: location.countryCode,
    timezone: (await geo?.timezoneAt(location).catch(() => null)) ?? null,
  });

  return {
    /**
     * My trips, each with whether I archived it and how many chat messages I
     * haven't read; plus, for owners, deleted trips that can still be restored.
     */
    async listForUser(userId: string): Promise<MyTrips> {
      const rows = await db
        .select({
          id: trips.id,
          name: trips.name,
          destination: trips.destination,
          startDate: trips.startDate,
          endDate: trips.endDate,
          coverColor: trips.coverColor,
          myRole: tripMembers.role,
          memberCount: activeMemberCount,
          archivedAt: tripMembers.archivedAt,
        })
        .from(tripMembers)
        .innerJoin(trips, eq(trips.id, tripMembers.tripId))
        .where(and(eq(tripMembers.userId, userId), isNull(tripMembers.leftAt), isNull(trips.deletedAt)))
        .orderBy(sql`${trips.startDate} asc nulls last`, desc(trips.createdAt));
      const unread = await unreadCounts(db, userId, rows.map((r) => r.id));
      const summaries: TripSummary[] = rows.map(({ archivedAt, ...r }) => ({
        ...r,
        myRole: r.myRole as TripRole,
        archived: archivedAt !== null,
        unreadCount: unread.get(r.id) ?? 0,
      }));

      const deletedRows = await db
        .select({
          id: trips.id,
          name: trips.name,
          destination: trips.destination,
          coverColor: trips.coverColor,
          deletedAt: trips.deletedAt,
        })
        .from(tripMembers)
        .innerJoin(trips, eq(trips.id, tripMembers.tripId))
        .where(
          and(
            eq(tripMembers.userId, userId),
            eq(tripMembers.role, 'owner'),
            isNull(tripMembers.leftAt),
            gt(trips.deletedAt, new Date(Date.now() - RESTORE_MS)),
          ),
        )
        .orderBy(desc(trips.deletedAt));
      const deleted: DeletedTrip[] = deletedRows.map((r) => ({
        ...r,
        deletedAt: r.deletedAt!.toISOString(),
        purgeAt: new Date(r.deletedAt!.getTime() + RESTORE_MS).toISOString(),
      }));
      return { trips: summaries, deleted };
    },

    /** Hides the trip from my list only; everyone else still sees it as before. */
    async setArchived(tripId: string, userId: string, archived: boolean) {
      await requireTripRole(db, tripId, userId, 'viewer');
      await db
        .update(tripMembers)
        .set({ archivedAt: archived ? sql`coalesce(${tripMembers.archivedAt}, now())` : null })
        .where(memberOf(tripId, userId));
    },

    /**
     * The owner deletes the trip for everyone. It disappears at once, but its
     * rows and files stay for TRIP_RESTORE_DAYS so the owner can bring it back;
     * after that the daily purge removes them.
     */
    async remove(tripId: string, userId: string, origin?: string) {
      await requireTripRole(db, tripId, userId, 'owner');
      await db.transaction(async (tx) => {
        const [row] = await tx
          .update(trips)
          .set({ deletedAt: sql`now()`, version: sql`${trips.version} + 1` })
          .where(and(eq(trips.id, tripId), isNull(trips.deletedAt)))
          .returning({ id: trips.id });
        if (!row) throw notFound('Trip not found');
        await tx.insert(changeLog).values({ tripId, entity: 'trip', entityId: tripId, op: 'delete', changedBy: userId });
        // Kept in the history, so a restored trip shows what happened.
        await postSystemMessage(tx, tripId, userId, (name) => `${name} deleted the trip`, { event: 'trip_deleted' });
      });
      // Open screens leave the trip, and the gateway stops sending it.
      if (redis) {
        await publishTripEvent(redis, {
          type: 'trip.deleted',
          tripId,
          entityId: tripId,
          actorId: userId,
          originClientId: origin,
        });
      }
    },

    /** Brings a deleted trip back for everyone, within TRIP_RESTORE_DAYS. Owners only. */
    async restore(tripId: string, userId: string): Promise<Trip> {
      const [row] = await db
        .select({ role: tripMembers.role, deletedAt: trips.deletedAt })
        .from(tripMembers)
        .innerJoin(trips, eq(trips.id, tripMembers.tripId))
        .where(and(memberOf(tripId, userId), isNotNull(trips.deletedAt)));
      // Members who aren't owners shouldn't learn the trip still exists.
      if (!row || row.role !== 'owner' || row.deletedAt!.getTime() < Date.now() - RESTORE_MS) {
        throw notFound('Trip not found');
      }
      await db.transaction(async (tx) => {
        await tx
          .update(trips)
          .set({ deletedAt: null, version: sql`${trips.version} + 1` })
          .where(eq(trips.id, tripId));
        await tx.insert(changeLog).values({ tripId, entity: 'trip', entityId: tripId, op: 'upsert', changedBy: userId });
        await postSystemMessage(tx, tripId, userId, (name) => `${name} restored the trip`, { event: 'trip_restored' });
      });
      return this.get(tripId, userId);
    },

    async get(tripId: string, userId: string): Promise<Trip> {
      const myRole = await requireTripRole(db, tripId, userId, 'viewer');
      const [trip] = await db
        .select({
          id: trips.id,
          name: trips.name,
          destination: trips.destination,
          startDate: trips.startDate,
          endDate: trips.endDate,
          coverColor: trips.coverColor,
          baseCurrency: trips.baseCurrency,
          version: trips.version,
          memberCount: activeMemberCount,
          timezone: trips.timezone,
          placeId: trips.placeId,
          latitude: trips.latitude,
          longitude: trips.longitude,
          bounds: trips.bounds,
          countryCode: trips.countryCode,
          archivedAt: tripMembers.archivedAt,
        })
        .from(trips)
        .innerJoin(tripMembers, memberOf(tripId, userId))
        .where(eq(trips.id, tripId));
      if (!trip) throw new Error('Trip vanished after access check');
      const { placeId, latitude, longitude, bounds, countryCode, archivedAt, ...rest } = trip;
      const location =
        placeId && latitude !== null && longitude !== null
          ? { placeId, latitude, longitude, bounds: bounds ?? null, countryCode: countryCode?.trim() || null }
          : null;

      const members = await db
        .select({ userId: users.id, displayName: users.displayName, role: tripMembers.role, upiId: users.upiId })
        .from(tripMembers)
        .innerJoin(users, eq(users.id, tripMembers.userId))
        .where(and(eq(tripMembers.tripId, tripId), isNull(tripMembers.leftAt)))
        .orderBy(asc(tripMembers.joinedAt));

      return {
        ...rest,
        archived: archivedAt !== null,
        location,
        myRole,
        myUserId: userId,
        members: members.map((m) => ({ ...m, role: m.role as TripRole })),
      };
    },

    /**
     * Creates the trip, makes the creator its owner and logs the change, all in
     * one transaction. Retrying with the same client-generated id is safe.
     */
    async create(input: CreateTrip, userId: string): Promise<{ trip: Trip; created: boolean }> {
      const id = input.id ?? newId();
      const created = await db.transaction(async (tx) => {
        const inserted = await tx
          .insert(trips)
          .values({
            id,
            name: input.name,
            destination: input.destination,
            startDate: input.startDate ?? null,
            endDate: input.endDate ?? null,
            baseCurrency: input.baseCurrency,
            coverColor: input.coverColor,
            ...(input.location ? await locationColumns(input.location) : {}),
            createdBy: userId,
          })
          .onConflictDoNothing()
          .returning({ id: trips.id });

        if (inserted.length === 0) {
          const [existing] = await tx
            .select({ createdBy: trips.createdBy })
            .from(trips)
            .where(eq(trips.id, id));
          if (existing?.createdBy !== userId) throw conflict('A trip with that id already exists');
          return false;
        }

        await tx.insert(tripMembers).values({ tripId: id, userId, role: 'owner' });
        await tx
          .insert(changeLog)
          .values({ tripId: id, entity: 'trip', entityId: id, op: 'upsert', changedBy: userId });
        return true;
      });

      return { trip: await this.get(id, userId), created };
    },

    /**
     * Changes the trip's name, place, dates or currency. Editors can, since a
     * trip's dates are everyone's business. The currency is locked once there
     * are expenses, because every expense is stored converted into it.
     */
    async update(tripId: string, userId: string, input: UpdateTrip, origin?: string): Promise<Trip> {
      await requireTripRole(db, tripId, userId, 'editor');
      const { version, ...fields } = input;
      const [current] = await db
        .select({ startDate: trips.startDate, endDate: trips.endDate, baseCurrency: trips.baseCurrency })
        .from(trips)
        .where(eq(trips.id, tripId));
      const start = fields.startDate !== undefined ? fields.startDate : current!.startDate;
      const end = fields.endDate !== undefined ? fields.endDate : current!.endDate;
      if (start && end && end < start) throw badRequest('End date must be on or after the start date');
      if (fields.baseCurrency && fields.baseCurrency !== current!.baseCurrency) {
        const [spent] = await db
          .select({ id: expenses.id })
          .from(expenses)
          .where(and(eq(expenses.tripId, tripId), isNull(expenses.deletedAt)))
          .limit(1);
        if (spent) throw badRequest('The currency can’t change once there are expenses', 'currency_locked');
      }

      const { location, ...plain } = fields;
      const placeColumns =
        location === undefined
          ? {}
          : location === null
            ? { placeId: null, latitude: null, longitude: null, bounds: null, countryCode: null, timezone: null }
            : await locationColumns(location);

      const updated = await db.transaction(async (tx) => {
        const [row] = await tx
          .update(trips)
          .set({
            ...Object.fromEntries(Object.entries(plain).filter(([, v]) => v !== undefined)),
            ...placeColumns,
            version: sql`${trips.version} + 1`,
          })
          .where(and(eq(trips.id, tripId), eq(trips.version, version), isNull(trips.deletedAt)))
          .returning({ id: trips.id });
        if (!row) return false;
        await tx.insert(changeLog).values({ tripId, entity: 'trip', entityId: tripId, op: 'upsert', changedBy: userId });
        return true;
      });
      const trip = await this.get(tripId, userId);
      if (!updated) {
        throw conflict('Someone changed the trip while you were editing. Showing the latest version.', { current: trip });
      }
      if (redis) {
        await publishTripEvent(redis, {
          type: 'trip.updated',
          tripId,
          entityId: tripId,
          actorId: userId,
          version: trip.version,
          originClientId: origin,
        });
      }
      return trip;
    },
  };
};
