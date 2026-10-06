import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import { changeLog, items, type Db, type Tx } from '@tagalong/db';
import {
  CreateItemInput,
  newId,
  positionBetween,
  UpdateItemInput,
  type ItineraryItem,
} from '@tagalong/shared';
import type { Redis } from 'ioredis';
import type { z } from 'zod';
import { requireTripRole } from '../../lib/access';
import { conflict, notFound } from '../../lib/errors';
import { publishTripEvent } from '../../lib/events';
import { postSystemMessage } from '../chat/channel';

type CreateItem = z.output<typeof CreateItemInput>;
type UpdateItem = z.output<typeof UpdateItemInput>;
type Row = typeof items.$inferSelect;

/** Postgres returns times as "HH:MM:SS"; the app works in "HH:MM". */
const hhmm = (t: string | null) => (t ? t.slice(0, 5) : null);

export const toItem = (r: Row): ItineraryItem => ({
  id: r.id,
  tripId: r.tripId,
  date: r.date,
  startTime: hhmm(r.startTime),
  endTime: hhmm(r.endTime),
  position: r.position,
  type: r.type as ItineraryItem['type'],
  title: r.title,
  notes: r.notes,
  placeName: r.placeName,
  costEstimateMinor: r.costEstimateMinor,
  costCurrency: r.costCurrency,
  createdBy: r.createdBy,
  version: r.version,
  updatedAt: r.updatedAt.toISOString(),
});

const sameDay = (date: string | null) => (date ? eq(items.date, date) : isNull(items.date));

/**
 * Position keys must compare byte by byte ("C" collation). The database's
 * default, language-aware collation would sort some keys in the wrong order.
 */
const byPosition = sql`${items.position} collate "C"`;

/** The key that puts a new item after everything already on that day. */
export const endOfDay = async (tx: Tx, tripId: string, date: string | null) => {
  const [last] = await tx
    .select({ position: items.position })
    .from(items)
    .where(and(eq(items.tripId, tripId), sameDay(date), isNull(items.deletedAt)))
    .orderBy(desc(byPosition))
    .limit(1);
  return positionBetween(last?.position ?? null, null);
};

export const createItineraryService = (db: Db, redis: Redis) => {
  /** Loads a live item and checks the user can act on its trip. */
  const loadForWrite = async (itemId: string, userId: string) => {
    const [row] = await db
      .select()
      .from(items)
      .where(and(eq(items.id, itemId), isNull(items.deletedAt)));
    if (!row) throw notFound('That item no longer exists');
    await requireTripRole(db, row.tripId, userId, 'editor');
    return row;
  };

  return {
    async list(tripId: string, userId: string): Promise<ItineraryItem[]> {
      await requireTripRole(db, tripId, userId, 'viewer');
      const rows = await db
        .select()
        .from(items)
        .where(and(eq(items.tripId, tripId), isNull(items.deletedAt)))
        .orderBy(sql`${items.date} asc nulls first`, asc(byPosition));
      return rows.map(toItem);
    },

    /** Retrying with the same client-generated id returns the same item. */
    async create(tripId: string, userId: string, input: CreateItem, origin?: string) {
      await requireTripRole(db, tripId, userId, 'editor');
      const id = input.id ?? newId();
      const date = input.date ?? null;

      const result = await db.transaction(async (tx) => {
        const [inserted] = await tx
          .insert(items)
          .values({
            id,
            tripId,
            date,
            startTime: input.startTime ?? null,
            endTime: input.endTime ?? null,
            position: input.position ?? (await endOfDay(tx, tripId, date)),
            type: input.type,
            title: input.title,
            notes: input.notes ?? null,
            placeName: input.placeName ?? null,
            costEstimateMinor: input.costEstimateMinor ?? null,
            costCurrency: input.costCurrency ?? null,
            createdBy: userId,
          })
          .onConflictDoNothing()
          .returning();

        if (!inserted) {
          const [existing] = await tx.select().from(items).where(eq(items.id, id));
          if (!existing || existing.tripId !== tripId || existing.createdBy !== userId) {
            throw conflict('An item with that id already exists');
          }
          return { item: toItem(existing), created: false, card: null };
        }

        await tx
          .insert(changeLog)
          .values({ tripId, entity: 'item', entityId: id, op: 'upsert', changedBy: userId });
        const card = await postSystemMessage(
          tx,
          tripId,
          userId,
          (name) => `${name} added “${input.title}” to the plan`,
          { event: 'item_added', itemId: id },
        );
        return { item: toItem(inserted), created: true, card };
      });

      if (result.created) {
        await publishTripEvent(redis, {
          type: 'item.upserted',
          tripId,
          entityId: id,
          actorId: userId,
          version: result.item.version,
          payload: result.item,
          originClientId: origin,
        });
      }
      if (result.card) {
        // No origin: the person who added it should see the card in chat too.
        await publishTripEvent(redis, {
          type: 'message.created',
          tripId,
          entityId: result.card.id,
          actorId: userId,
          payload: result.card,
        });
      }
      return { item: result.item, created: result.created };
    },

    /**
     * Saves only if `version` still matches. Otherwise someone else changed it
     * first: we answer 409 with their copy so the app can show it.
     */
    async update(itemId: string, userId: string, input: UpdateItem, origin?: string) {
      const current = await loadForWrite(itemId, userId);
      const { version, ...fields } = input;
      const changes = Object.fromEntries(
        Object.entries(fields).filter(([, v]) => v !== undefined),
      ) as Partial<typeof items.$inferInsert>;

      const updated = await db.transaction(async (tx) => {
        const [row] = await tx
          .update(items)
          .set({ ...changes, version: sql`${items.version} + 1` })
          .where(and(eq(items.id, itemId), eq(items.version, version), isNull(items.deletedAt)))
          .returning();
        if (!row) return null;
        await tx.insert(changeLog).values({
          tripId: row.tripId,
          entity: 'item',
          entityId: itemId,
          op: 'upsert',
          changedBy: userId,
        });
        return row;
      });

      if (!updated) {
        const [latest] = await db
          .select()
          .from(items)
          .where(and(eq(items.id, itemId), isNull(items.deletedAt)));
        if (!latest) throw notFound('That item no longer exists');
        throw conflict('Someone changed this while you were editing. Showing the latest version.', {
          current: toItem(latest),
        });
      }

      const item = toItem(updated);
      await publishTripEvent(redis, {
        type: 'item.upserted',
        tripId: current.tripId,
        entityId: itemId,
        actorId: userId,
        version: item.version,
        payload: item,
        originClientId: origin,
      });
      return item;
    },

    async remove(itemId: string, userId: string, origin?: string) {
      const current = await loadForWrite(itemId, userId);
      const deleted = await db.transaction(async (tx) => {
        const [row] = await tx
          .update(items)
          .set({ deletedAt: new Date(), version: sql`${items.version} + 1` })
          .where(and(eq(items.id, itemId), isNull(items.deletedAt)))
          .returning({ version: items.version });
        if (!row) return null;
        await tx.insert(changeLog).values({
          tripId: current.tripId,
          entity: 'item',
          entityId: itemId,
          op: 'delete',
          changedBy: userId,
        });
        return row;
      });
      if (!deleted) return;

      await publishTripEvent(redis, {
        type: 'item.deleted',
        tripId: current.tripId,
        entityId: itemId,
        actorId: userId,
        version: deleted.version,
        originClientId: origin,
      });
    },
  };
};
