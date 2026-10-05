import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import { changeLog, tripMembers, trips, users, type Db } from '@tagalong/db';
import {
  CreateTripInput,
  newId,
  type Trip,
  type TripRole,
  type TripSummary,
} from '@tagalong/shared';
import type { z } from 'zod';
import { requireTripRole } from '../../lib/access';
import { conflict } from '../../lib/errors';

type CreateTrip = z.output<typeof CreateTripInput>;

const activeMemberCount = sql<number>`(
  select count(*)::int from ${tripMembers} m
  where m.trip_id = ${trips.id} and m.left_at is null
)`;

export const createTripsService = (db: Db) => ({
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
      .select({ userId: users.id, displayName: users.displayName, role: tripMembers.role })
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
});
