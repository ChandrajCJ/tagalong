import { and, desc, eq, gt, isNull, or, sql } from 'drizzle-orm';
import { changeLog, invites, tripMembers, trips, users, type Db } from '@tagalong/db';
import {
  CreateInviteInput,
  type Invite,
  type InvitePreview,
  type Trip,
} from '@tagalong/shared';
import type { Redis } from 'ioredis';
import type { z } from 'zod';
import { requireTripRole } from '../../lib/access';
import { randomToken, sha256 } from '../../lib/crypto';
import { notFound } from '../../lib/errors';
import { publishTripEvent } from '../../lib/events';
import { createTripsService } from '../trips/service';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const GONE = 'This invite link has expired or was turned off. Ask for a new one.';

type CreateInvite = z.output<typeof CreateInviteInput>;

/** An invite is usable when it isn't revoked, expired or used up. */
const usable = () =>
  and(
    isNull(invites.revokedAt),
    gt(invites.expiresAt, new Date()),
    or(isNull(invites.maxUses), sql`${invites.useCount} < ${invites.maxUses}`),
  );

export const createInvitesService = (db: Db, redis: Redis) => {
  const tripsService = createTripsService(db);

  return {
    async create(tripId: string, userId: string, input: CreateInvite): Promise<Invite> {
      // Viewers can't invite. The input schema already stops anyone granting owner.
      await requireTripRole(db, tripId, userId, 'editor');

      const token = randomToken();
      const [row] = await db
        .insert(invites)
        .values({
          tripId,
          tokenHash: sha256(token),
          role: input.role,
          maxUses: input.maxUses ?? null,
          createdBy: userId,
          expiresAt: new Date(Date.now() + INVITE_TTL_MS),
        })
        .returning();
      if (!row) throw new Error('Failed to create invite');

      const [creator] = await db
        .select({ name: users.displayName })
        .from(users)
        .where(eq(users.id, userId));

      return {
        id: row.id,
        token,
        role: row.role as Invite['role'],
        expiresAt: row.expiresAt.toISOString(),
        maxUses: row.maxUses,
        useCount: row.useCount,
        createdByName: creator?.name ?? '',
      };
    },

    async listActive(tripId: string, userId: string): Promise<Invite[]> {
      await requireTripRole(db, tripId, userId, 'owner');
      const rows = await db
        .select({
          id: invites.id,
          role: invites.role,
          expiresAt: invites.expiresAt,
          maxUses: invites.maxUses,
          useCount: invites.useCount,
          createdByName: users.displayName,
        })
        .from(invites)
        .innerJoin(users, eq(users.id, invites.createdBy))
        .where(and(eq(invites.tripId, tripId), usable()))
        .orderBy(desc(invites.createdAt));
      return rows.map((r) => ({
        ...r,
        role: r.role as Invite['role'],
        expiresAt: r.expiresAt.toISOString(),
      }));
    },

    async revoke(tripId: string, inviteId: string, userId: string) {
      await requireTripRole(db, tripId, userId, 'owner');
      const updated = await db
        .update(invites)
        .set({ revokedAt: new Date() })
        .where(and(eq(invites.id, inviteId), eq(invites.tripId, tripId), isNull(invites.revokedAt)))
        .returning({ id: invites.id });
      if (updated.length === 0) throw notFound('Invite not found');
    },

    async preview(token: string, userId: string): Promise<InvitePreview> {
      const [row] = await db
        .select({
          tripId: trips.id,
          tripName: trips.name,
          destination: trips.destination,
          startDate: trips.startDate,
          endDate: trips.endDate,
          coverColor: trips.coverColor,
          inviterName: users.displayName,
          role: invites.role,
        })
        .from(invites)
        .innerJoin(trips, eq(trips.id, invites.tripId))
        .innerJoin(users, eq(users.id, invites.createdBy))
        .where(and(eq(invites.tokenHash, sha256(token)), usable(), isNull(trips.deletedAt)))
        .limit(1);
      if (!row) throw notFound(GONE);

      const members = await db
        .select({ userId: tripMembers.userId })
        .from(tripMembers)
        .where(and(eq(tripMembers.tripId, row.tripId), isNull(tripMembers.leftAt)));

      return {
        ...row,
        role: row.role as InvitePreview['role'],
        memberCount: members.length,
        alreadyMember: members.some((m) => m.userId === userId),
      };
    },

    /**
     * Joins the trip. Safe to call twice: an existing member just gets the trip
     * back, and someone who left before rejoins with the invite's role.
     */
    async accept(token: string, userId: string): Promise<Trip> {
      const { tripId, joined } = await db.transaction(async (tx) => {
        const [invite] = await tx
          .select()
          .from(invites)
          .where(and(eq(invites.tokenHash, sha256(token)), usable()))
          .for('update')
          .limit(1);
        if (!invite) throw notFound(GONE);

        const [trip] = await tx
          .select({ id: trips.id })
          .from(trips)
          .where(and(eq(trips.id, invite.tripId), isNull(trips.deletedAt)));
        if (!trip) throw notFound(GONE);

        const [existing] = await tx
          .select({ leftAt: tripMembers.leftAt })
          .from(tripMembers)
          .where(and(eq(tripMembers.tripId, invite.tripId), eq(tripMembers.userId, userId)));

        // Already in: nothing to do.
        if (existing && !existing.leftAt) return { tripId: invite.tripId, joined: false };

        if (existing) {
          await tx
            .update(tripMembers)
            .set({ leftAt: null, role: invite.role, joinedAt: new Date() })
            .where(and(eq(tripMembers.tripId, invite.tripId), eq(tripMembers.userId, userId)));
        } else {
          await tx.insert(tripMembers).values({ tripId: invite.tripId, userId, role: invite.role });
        }

        await tx
          .update(invites)
          .set({ useCount: sql`${invites.useCount} + 1`, acceptedBy: userId, acceptedAt: new Date() })
          .where(eq(invites.id, invite.id));
        await tx.insert(changeLog).values({
          tripId: invite.tripId,
          entity: 'trip_member',
          entityId: userId,
          op: 'upsert',
          changedBy: userId,
        });
        return { tripId: invite.tripId, joined: true };
      });

      if (joined) {
        await publishTripEvent(redis, {
          type: 'member.joined',
          tripId,
          entityId: userId,
          actorId: userId,
          payload: { userId },
        });
      }
      return tripsService.get(tripId, userId);
    },
  };
};
