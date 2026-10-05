import { and, eq, isNull, sql } from 'drizzle-orm';
import { changeLog, tripMembers, type Db, type Tx } from '@tagalong/db';
import type { TripRole } from '@tagalong/shared';
import { requireTripRole } from '../../lib/access';
import { conflict, notFound } from '../../lib/errors';

const activeMember = (tripId: string, userId: string) =>
  and(eq(tripMembers.tripId, tripId), eq(tripMembers.userId, userId), isNull(tripMembers.leftAt));

/** Locks the trip's owner rows so two owners can't both step down at once. */
const ownerCount = async (tx: Tx, tripId: string) => {
  const owners = await tx
    .select({ userId: tripMembers.userId })
    .from(tripMembers)
    .where(
      and(eq(tripMembers.tripId, tripId), eq(tripMembers.role, 'owner'), isNull(tripMembers.leftAt)),
    )
    .for('update');
  return owners.length;
};

const LAST_OWNER =
  'Every trip needs an owner. Make someone else an owner first.';

export const createMembersService = (db: Db) => ({
  /** Owners can change anyone's role, including making co-owners. */
  async updateRole(tripId: string, targetUserId: string, role: TripRole, actorId: string) {
    await requireTripRole(db, tripId, actorId, 'owner');
    await db.transaction(async (tx) => {
      const [target] = await tx
        .select({ role: tripMembers.role })
        .from(tripMembers)
        .where(activeMember(tripId, targetUserId));
      if (!target) throw notFound('Member not found');
      if (target.role === role) return;

      if (target.role === 'owner' && (await ownerCount(tx, tripId)) <= 1) {
        throw conflict(LAST_OWNER);
      }
      await tx.update(tripMembers).set({ role }).where(activeMember(tripId, targetUserId));
      await tx.insert(changeLog).values({
        tripId,
        entity: 'trip_member',
        entityId: targetUserId,
        op: 'upsert',
        changedBy: actorId,
      });
    });
  },

  /** Removing yourself is leaving; removing someone else needs an owner. */
  async remove(tripId: string, targetUserId: string, actorId: string) {
    const leaving = targetUserId === actorId;
    await requireTripRole(db, tripId, actorId, leaving ? 'viewer' : 'owner');

    await db.transaction(async (tx) => {
      const [target] = await tx
        .select({ role: tripMembers.role })
        .from(tripMembers)
        .where(activeMember(tripId, targetUserId));
      if (!target) throw notFound('Member not found');

      if (target.role === 'owner' && (await ownerCount(tx, tripId)) <= 1) {
        throw conflict(LAST_OWNER);
      }
      await tx
        .update(tripMembers)
        .set({ leftAt: sql`now()` })
        .where(activeMember(tripId, targetUserId));
      await tx.insert(changeLog).values({
        tripId,
        entity: 'trip_member',
        entityId: targetUserId,
        op: 'delete',
        changedBy: actorId,
      });
    });
  },
});
