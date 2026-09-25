import { and, eq, isNull } from 'drizzle-orm';
import { tripMembers, trips, type Db, type Tx } from '@tagalong/db';
import { hasRole, type TripRole } from '@tagalong/shared';
import { forbidden, notFound } from './errors';

/**
 * The one permission check every trip route goes through.
 * Non-members get 404 rather than 403 so trip ids don't leak.
 */
export const requireTripRole = async (
  db: Db | Tx,
  tripId: string,
  userId: string,
  minRole: TripRole,
): Promise<TripRole> => {
  const [row] = await db
    .select({ role: tripMembers.role })
    .from(tripMembers)
    .innerJoin(trips, eq(trips.id, tripMembers.tripId))
    .where(
      and(
        eq(tripMembers.tripId, tripId),
        eq(tripMembers.userId, userId),
        isNull(tripMembers.leftAt),
        isNull(trips.deletedAt),
      ),
    )
    .limit(1);

  if (!row) throw notFound('Trip not found');
  const role = row.role as TripRole;
  if (!hasRole(role, minRole)) throw forbidden();
  return role;
};
