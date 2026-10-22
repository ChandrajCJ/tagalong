import { and, asc, desc, eq, gt, isNotNull, isNull, sql } from 'drizzle-orm';
import { changeLog, expenses, photos, tripMembers, tripPlaces, trips, users, type Db } from '@tagalong/db';
import {
  CreateTripInput,
  newId,
  positionsBetween,
  TRIP_RESTORE_DAYS,
  tripSummary,
  UpdateTripInput,
  type DeletedTrip,
  type MyTrips,
  type Trip,
  type TripRole,
  type TripSummary,
} from '@tagalong/shared';
import type { Redis } from 'ioredis';
import type { z } from 'zod';
import { requireTripRole } from '../../lib/access';
import { avatarOf } from '../../lib/avatars';
import { badRequest, conflict, notFound } from '../../lib/errors';
import { publishTripEvent } from '../../lib/events';
import type { Geo } from '../../lib/geo';
import type { Notifier } from '../../lib/notifier';
import { readinessFor } from '../../lib/readiness';
import type { Storage } from '../../lib/storage';
import { postSystemMessage, unreadCounts } from '../chat/channel';
import { announceBudget, checkBudgetAlerts, editBudget, writeBudget } from '../money/budget';
import { checkPlaceDates, locationColumns, placeRows, toPlace } from './places';

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

/** The cover photo's file, while that photo is still there. */
const coverJoin = and(eq(photos.id, trips.coverMediaId), isNull(photos.deletedAt), eq(photos.status, 'ready'));

export const createTripsService = (
  db: Db,
  redis?: Redis,
  geo?: Geo,
  storage?: Storage,
  ttl = 600,
  notifier?: Notifier,
) => {
  /** A short-lived link to the cover, or null for a colour-only cover. */
  const coverUrl = async (key: string | null) =>
    key && storage ? storage.downloadUrl(key, 'cover.jpg', ttl) : null;

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
          coverCredit: trips.coverCredit,
          coverKey: photos.storageKey,
          myRole: tripMembers.role,
          memberCount: activeMemberCount,
          archivedAt: tripMembers.archivedAt,
        })
        .from(tripMembers)
        .innerJoin(trips, eq(trips.id, tripMembers.tripId))
        .leftJoin(photos, coverJoin)
        .where(and(eq(tripMembers.userId, userId), isNull(tripMembers.leftAt), isNull(trips.deletedAt)))
        .orderBy(sql`${trips.startDate} asc nulls last`, desc(trips.createdAt));
      const unread = await unreadCounts(db, userId, rows.map((r) => r.id));
      const readiness = await readinessFor(db, userId, rows.map((r) => r.id));
      const summaries: TripSummary[] = await Promise.all(
        rows.map(async ({ archivedAt, coverKey, ...r }) => ({
          ...r,
          coverUrl: await coverUrl(coverKey),
          coverCredit: coverKey ? r.coverCredit : null,
          myRole: r.myRole as TripRole,
          archived: archivedAt !== null,
          unreadCount: unread.get(r.id) ?? 0,
          readiness: readiness.get(r.id) ?? null,
        })),
      );

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
          coverCredit: trips.coverCredit,
          coverPhotoId: photos.id,
          coverKey: photos.storageKey,
        })
        .from(trips)
        .innerJoin(tripMembers, memberOf(tripId, userId))
        .leftJoin(photos, coverJoin)
        .where(eq(trips.id, tripId));
      if (!trip) throw new Error('Trip vanished after access check');
      const { placeId, latitude, longitude, bounds, countryCode, archivedAt, coverKey, coverCredit, coverPhotoId, ...rest } =
        trip;
      const location =
        placeId && latitude !== null && longitude !== null
          ? { placeId, latitude, longitude, bounds: bounds ?? null, countryCode: countryCode?.trim() || null }
          : null;

      const members = await db
        .select({
          userId: users.id,
          displayName: users.displayName,
          role: tripMembers.role,
          upiId: users.upiId,
          joinedAt: tripMembers.joinedAt,
          avatarKey: users.avatarKey,
        })
        .from(tripMembers)
        .innerJoin(users, eq(users.id, tripMembers.userId))
        .where(and(eq(tripMembers.tripId, tripId), isNull(tripMembers.leftAt)))
        .orderBy(asc(tripMembers.joinedAt));
      const places = (await placeRows(db, tripId)).map(toPlace);

      return {
        ...rest,
        places,
        archived: archivedAt !== null,
        coverPhotoId: coverKey ? coverPhotoId : null,
        coverUrl: await coverUrl(coverKey),
        coverCredit: coverKey ? coverCredit : null,
        location,
        myRole,
        myUserId: userId,
        members: await Promise.all(
          members.map(async ({ avatarKey, ...m }) => ({
            ...m,
            role: m.role as TripRole,
            joinedAt: m.joinedAt.toISOString(),
            ...(await avatarOf(storage, avatarKey)),
          })),
        ),
      };
    },

    /**
     * Creates the trip, makes the creator its owner and logs the change, all in
     * one transaction. Retrying with the same client-generated id is safe.
     */
    async create(input: CreateTrip, userId: string): Promise<{ trip: Trip; created: boolean }> {
      const id = input.id ?? newId();
      // Older phones send one destination; newer ones every place, in order.
      const wanted = input.places ?? [{ destination: input.destination, location: input.location, startDate: null, endDate: null }];
      const positions = positionsBetween(null, null, wanted.length);
      const placeValues = await Promise.all(
        wanted.map(async (p, i) => ({
          id: ('id' in p && p.id) || newId(),
          tripId: id,
          position: positions[i]!,
          destination: p.destination,
          startDate: p.startDate ?? null,
          endDate: p.endDate ?? null,
          ...(await locationColumns(geo, p.location)),
        })),
      );
      checkPlaceDates(placeValues, { startDate: input.startDate ?? null, endDate: input.endDate ?? null });
      const summary = tripSummary(placeValues);
      const created = await db.transaction(async (tx) => {
        const inserted = await tx
          .insert(trips)
          .values({
            id,
            name: input.name,
            startDate: input.startDate ?? null,
            endDate: input.endDate ?? null,
            baseCurrency: input.baseCurrency,
            coverColor: input.coverColor,
            ...summary,
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
        await tx.insert(tripPlaces).values(placeValues);
        if (input.budget) await writeBudget(tx, id, userId, { ...input.budget, categories: {} });
        await tx.insert(changeLog).values([
          { tripId: id, entity: 'trip', entityId: id, op: 'upsert', changedBy: userId },
          ...placeValues.map((p) => ({ tripId: id, entity: 'place', entityId: p.id, op: 'upsert', changedBy: userId })),
        ]);
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
        .select({
          name: trips.name,
          destination: trips.destination,
          startDate: trips.startDate,
          endDate: trips.endDate,
          baseCurrency: trips.baseCurrency,
        })
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

      const { location, destination, budget, ...plain } = fields;
      // An older phone's edit screen sends the destination every time; only a change (or a newly
      // picked place) touches the places, and then the first one.
      const placeChanged = location !== undefined || (destination !== undefined && destination !== current!.destination);
      const placeColumns = location === undefined ? {} : await locationColumns(geo, location);
      const datesChanged = fields.startDate !== undefined || fields.endDate !== undefined;

      const updated = await db.transaction(async (tx) => {
        const [row] = await tx
          .update(trips)
          .set({
            ...Object.fromEntries(Object.entries(plain).filter(([, v]) => v !== undefined)),
            version: sql`${trips.version} + 1`,
          })
          .where(and(eq(trips.id, tripId), eq(trips.version, version), isNull(trips.deletedAt)))
          .returning({ id: trips.id });
        if (!row) return null;
        let places = await placeRows(tx, tripId);
        if (datesChanged) {
          try {
            checkPlaceDates(places, { startDate: start ?? null, endDate: end ?? null });
          } catch (e) {
            throw badRequest(`${(e as Error).message} Change the places’ dates first.`, 'place_dates');
          }
        }
        if (placeChanged && places[0]) {
          const first = places[0];
          await tx
            .update(tripPlaces)
            .set({ ...(destination !== undefined ? { destination } : {}), ...placeColumns, version: sql`${tripPlaces.version} + 1` })
            .where(eq(tripPlaces.id, first.id));
          await tx.insert(changeLog).values({ tripId, entity: 'place', entityId: first.id, op: 'upsert', changedBy: userId });
          places = await placeRows(tx, tripId);
          await tx
            .update(trips)
            .set(tripSummary(places.map((p) => ({ ...p, countryCode: p.countryCode?.trim() || null }))))
            .where(eq(trips.id, tripId));
        }
        await tx.insert(changeLog).values({ tripId, entity: 'trip', entityId: tripId, op: 'upsert', changedBy: userId });
        // Set when the budget changed: the new one, or null once removed.
        const budgetChange = budget === undefined ? null : await editBudget(tx, tripId, userId, budget);
        return { budgetChange };
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
        if (updated.budgetChange) {
          await announceBudget(redis, tripId, userId, updated.budgetChange.budget, origin);
          await checkBudgetAlerts(db, redis, tripId, userId);
        }
      }
      // A new name or new dates is news for everyone; a new cover colour isn't.
      const renamed = trip.name !== current!.name;
      const redated = trip.startDate !== current!.startDate || trip.endDate !== current!.endDate;
      if (renamed || redated) {
        const what = renamed && redated ? 'renamed the trip and changed its dates' : renamed ? `renamed the trip “${trip.name}”` : 'changed the trip’s dates';
        await notifier?.activity('trip', tripId, userId, { text: what, url: `/trips/${tripId}` });
      }
      return trip;
    },
  };
};
