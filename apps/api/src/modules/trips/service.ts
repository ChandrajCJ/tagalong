import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import { changeLog, expenses, tripMembers, trips, users, type Db } from '@tagalong/db';
import {
  CreateTripInput,
  newId,
  UpdateTripInput,
  type Trip,
  type TripRole,
  type TripSummary,
} from '@tagalong/shared';
import type { Redis } from 'ioredis';
import type { z } from 'zod';
import { requireTripRole } from '../../lib/access';
import { badRequest, conflict } from '../../lib/errors';
import { publishTripEvent } from '../../lib/events';

type CreateTrip = z.output<typeof CreateTripInput>;
type UpdateTrip = z.output<typeof UpdateTripInput>;

const activeMemberCount = sql<number>`(
  select count(*)::int from ${tripMembers} m
  where m.trip_id = ${trips.id} and m.left_at is null
)`;

export const createTripsService = (db: Db, redis?: Redis) => ({
  async listForUser(userId: string): Promise<TripSummary[]> {
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
      })
      .from(tripMembers)
      .innerJoin(trips, eq(trips.id, tripMembers.tripId))
      .where(and(eq(tripMembers.userId, userId), isNull(tripMembers.leftAt), isNull(trips.deletedAt)))
      .orderBy(sql`${trips.startDate} asc nulls last`, desc(trips.createdAt));
    return rows.map((r) => ({ ...r, myRole: r.myRole as TripRole }));
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
      })
      .from(trips)
      .where(eq(trips.id, tripId));
    if (!trip) throw new Error('Trip vanished after access check');

    const members = await db
      .select({ userId: users.id, displayName: users.displayName, role: tripMembers.role, upiId: users.upiId })
      .from(tripMembers)
      .innerJoin(users, eq(users.id, tripMembers.userId))
      .where(and(eq(tripMembers.tripId, tripId), isNull(tripMembers.leftAt)))
      .orderBy(asc(tripMembers.joinedAt));

    return {
      ...trip,
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

    const updated = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(trips)
        .set({
          ...Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)),
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
});
