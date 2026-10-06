import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { changeLog, ideaVotes, ideas, items, users, type Db, type Tx } from '@tagalong/db';
import {
  CreateIdeaInput,
  newId,
  UpdateIdeaInput,
  type Idea,
  type IdeaVoter,
  type VoteValue,
} from '@tagalong/shared';
import type { Redis } from 'ioredis';
import type { z } from 'zod';
import { requireTripRole } from '../../lib/access';
import { conflict, notFound } from '../../lib/errors';
import { publishTripEvent } from '../../lib/events';
import { postSystemMessage } from '../chat/channel';
import { endOfDay, toItem } from '../itinerary/service';

type CreateIdea = z.output<typeof CreateIdeaInput>;
type UpdateIdea = z.output<typeof UpdateIdeaInput>;
type Row = typeof ideas.$inferSelect;

const toIdea = (r: Row, voters: IdeaVoter[], userId: string): Idea => ({
  id: r.id,
  tripId: r.tripId,
  title: r.title,
  note: r.note,
  url: r.url,
  type: r.type as Idea['type'],
  createdBy: r.createdBy,
  promotedItemId: r.promotedItemId,
  version: r.version,
  updatedAt: r.updatedAt.toISOString(),
  ups: voters.filter((v) => v.value === 'up').length,
  downs: voters.filter((v) => v.value === 'down').length,
  voters,
  myVote: voters.find((v) => v.userId === userId)?.value ?? null,
});

/** The board's order: most support first, and newest first among equals. */
const byScore = (a: Idea, b: Idea) =>
  b.ups - b.downs - (a.ups - a.downs) || b.updatedAt.localeCompare(a.updatedAt);

export const createIdeasService = (db: Db, redis: Redis) => {
  /** Every vote on these ideas, grouped by idea, with the voters' names. */
  const votersFor = async (db: Db | Tx, ideaIds: string[]) => {
    const byIdea = new Map<string, IdeaVoter[]>(ideaIds.map((id) => [id, []]));
    if (ideaIds.length === 0) return byIdea;
    const rows = await db
      .select({
        ideaId: ideaVotes.ideaId,
        userId: ideaVotes.userId,
        value: ideaVotes.value,
        displayName: users.displayName,
      })
      .from(ideaVotes)
      .innerJoin(users, eq(users.id, ideaVotes.userId))
      .where(inArray(ideaVotes.ideaId, ideaIds));
    for (const r of rows) {
      byIdea.get(r.ideaId)?.push({
        userId: r.userId,
        displayName: r.displayName,
        value: r.value as VoteValue,
      });
    }
    return byIdea;
  };

  /** Reads one idea back in the shape the app expects, votes included. */
  const hydrate = async (dbOrTx: Db | Tx, row: Row, userId: string) => {
    const voters = await votersFor(dbOrTx, [row.id]);
    return toIdea(row, voters.get(row.id) ?? [], userId);
  };

  const loadLive = async (ideaId: string) => {
    const [row] = await db
      .select()
      .from(ideas)
      .where(and(eq(ideas.id, ideaId), isNull(ideas.deletedAt)));
    if (!row) throw notFound('That idea no longer exists');
    return row;
  };

  const announce = (idea: Idea, actorId: string, origin?: string, type: 'idea.upserted' | 'idea.voted' = 'idea.upserted') =>
    publishTripEvent(redis, {
      type,
      tripId: idea.tripId,
      entityId: idea.id,
      actorId,
      version: idea.version,
      payload: idea,
      originClientId: origin,
    });

  return {
    async list(tripId: string, userId: string): Promise<Idea[]> {
      await requireTripRole(db, tripId, userId, 'viewer');
      const rows = await db
        .select()
        .from(ideas)
        .where(and(eq(ideas.tripId, tripId), isNull(ideas.deletedAt)))
        .orderBy(desc(ideas.createdAt));
      const voters = await votersFor(
        db,
        rows.map((r) => r.id),
      );
      return rows.map((r) => toIdea(r, voters.get(r.id) ?? [], userId)).sort(byScore);
    },

    /** Retrying with the same client-generated id returns the same idea. */
    async create(tripId: string, userId: string, input: CreateIdea, origin?: string) {
      await requireTripRole(db, tripId, userId, 'editor');
      const id = input.id ?? newId();

      const result = await db.transaction(async (tx) => {
        const [inserted] = await tx
          .insert(ideas)
          .values({
            id,
            tripId,
            title: input.title,
            note: input.note ?? null,
            url: input.url ?? null,
            type: input.type,
            createdBy: userId,
          })
          .onConflictDoNothing()
          .returning();

        if (!inserted) {
          const [existing] = await tx.select().from(ideas).where(eq(ideas.id, id));
          if (!existing || existing.tripId !== tripId || existing.createdBy !== userId) {
            throw conflict('An idea with that id already exists');
          }
          return { row: existing, created: false };
        }

        await tx
          .insert(changeLog)
          .values({ tripId, entity: 'idea', entityId: id, op: 'upsert', changedBy: userId });
        return { row: inserted, created: true };
      });

      const idea = await hydrate(db, result.row, userId);
      if (result.created) await announce(idea, userId, origin);
      return { idea, created: result.created };
    },

    /** Saves only if `version` still matches, exactly like plan items. */
    async update(ideaId: string, userId: string, input: UpdateIdea, origin?: string) {
      const current = await loadLive(ideaId);
      await requireTripRole(db, current.tripId, userId, 'editor');
      const { version, ...fields } = input;
      const changes = Object.fromEntries(
        Object.entries(fields).filter(([, v]) => v !== undefined),
      ) as Partial<typeof ideas.$inferInsert>;

      const updated = await db.transaction(async (tx) => {
        const [row] = await tx
          .update(ideas)
          .set({ ...changes, version: sql`${ideas.version} + 1` })
          .where(and(eq(ideas.id, ideaId), eq(ideas.version, version), isNull(ideas.deletedAt)))
          .returning();
        if (!row) return null;
        await tx.insert(changeLog).values({
          tripId: row.tripId,
          entity: 'idea',
          entityId: ideaId,
          op: 'upsert',
          changedBy: userId,
        });
        return row;
      });

      if (!updated) {
        const latest = await loadLive(ideaId);
        throw conflict('Someone changed this while you were editing. Showing the latest version.', {
          current: await hydrate(db, latest, userId),
        });
      }

      const idea = await hydrate(db, updated, userId);
      await announce(idea, userId, origin);
      return idea;
    },

    async remove(ideaId: string, userId: string, origin?: string) {
      const current = await loadLive(ideaId);
      await requireTripRole(db, current.tripId, userId, 'editor');
      const deleted = await db.transaction(async (tx) => {
        const [row] = await tx
          .update(ideas)
          .set({ deletedAt: new Date(), version: sql`${ideas.version} + 1` })
          .where(and(eq(ideas.id, ideaId), isNull(ideas.deletedAt)))
          .returning({ version: ideas.version });
        if (!row) return null;
        await tx.insert(changeLog).values({
          tripId: current.tripId,
          entity: 'idea',
          entityId: ideaId,
          op: 'delete',
          changedBy: userId,
        });
        return row;
      });
      if (!deleted) return;

      await publishTripEvent(redis, {
        type: 'idea.deleted',
        tripId: current.tripId,
        entityId: ideaId,
        actorId: userId,
        version: deleted.version,
        originClientId: origin,
      });
    },

    /**
     * Voting is deliberately open to viewers: having an opinion isn't editing.
     * Passing no value clears the vote.
     */
    async vote(ideaId: string, userId: string, value: VoteValue | null, origin?: string) {
      const current = await loadLive(ideaId);
      await requireTripRole(db, current.tripId, userId, 'viewer');

      if (value === null) {
        await db
          .delete(ideaVotes)
          .where(and(eq(ideaVotes.ideaId, ideaId), eq(ideaVotes.userId, userId)));
      } else {
        await db
          .insert(ideaVotes)
          .values({ ideaId, userId, value })
          .onConflictDoUpdate({
            target: [ideaVotes.ideaId, ideaVotes.userId],
            set: { value },
          });
      }

      const idea = await hydrate(db, current, userId);
      await announce(idea, userId, origin, 'idea.voted');
      return idea;
    },

    /**
     * Turns an idea into a real plan item, in one transaction so an idea can
     * never be marked promoted without the item existing. Promoting twice
     * returns the same item.
     */
    async promote(ideaId: string, userId: string, date: string | null, origin?: string) {
      const current = await loadLive(ideaId);
      await requireTripRole(db, current.tripId, userId, 'editor');

      if (current.promotedItemId) {
        const [existing] = await db
          .select()
          .from(items)
          .where(and(eq(items.id, current.promotedItemId), isNull(items.deletedAt)));
        if (existing) {
          return { idea: await hydrate(db, current, userId), item: toItem(existing) };
        }
      }

      const result = await db.transaction(async (tx) => {
        const itemId = newId();
        const [item] = await tx
          .insert(items)
          .values({
            id: itemId,
            tripId: current.tripId,
            date,
            position: await endOfDay(tx, current.tripId, date),
            type: current.type,
            title: current.title,
            notes: current.note,
            createdBy: userId,
          })
          .returning();

        const [idea] = await tx
          .update(ideas)
          .set({ promotedItemId: itemId, version: sql`${ideas.version} + 1` })
          .where(eq(ideas.id, ideaId))
          .returning();

        await tx.insert(changeLog).values([
          {
            tripId: current.tripId,
            entity: 'item',
            entityId: itemId,
            op: 'upsert',
            changedBy: userId,
          },
          {
            tripId: current.tripId,
            entity: 'idea',
            entityId: ideaId,
            op: 'upsert',
            changedBy: userId,
          },
        ]);

        const card = await postSystemMessage(
          tx,
          current.tripId,
          userId,
          (name) => `${name} moved “${current.title}” into the plan`,
          { event: 'idea_promoted', ideaId, itemId },
        );
        return { item: toItem(item!), idea: idea!, card };
      });

      await publishTripEvent(redis, {
        type: 'item.upserted',
        tripId: current.tripId,
        entityId: result.item.id,
        actorId: userId,
        version: result.item.version,
        payload: result.item,
        originClientId: origin,
      });
      // No origin: whoever promoted it should see the card in chat too.
      await publishTripEvent(redis, {
        type: 'message.created',
        tripId: current.tripId,
        entityId: result.card.id,
        actorId: userId,
        payload: result.card,
      });

      const idea = await hydrate(db, result.idea, userId);
      await announce(idea, userId, origin);
      return { idea, item: result.item };
    },
  };
};
