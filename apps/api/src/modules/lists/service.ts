import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { changeLog, items, listItemChecks, listItems, lists, tripMembers, type Db, type Tx } from '@tagalong/db';
import {
  CreateListInput,
  CreateListItemInput,
  newId,
  positionBetween,
  UpdateListInput,
  UpdateListItemInput,
  type ListItem,
  type ListKind,
  type ListsOverview,
  type TripList,
} from '@tagalong/shared';
import type { Redis } from 'ioredis';
import type { z } from 'zod';
import { requireTripRole } from '../../lib/access';
import { badRequest, conflict, notFound } from '../../lib/errors';
import { publishTripEvent } from '../../lib/events';

type CreateList = z.output<typeof CreateListInput>;
type UpdateList = z.output<typeof UpdateListInput>;
type CreateListItem = z.output<typeof CreateListItemInput>;
type UpdateListItem = z.output<typeof UpdateListItemInput>;
type ListRow = typeof lists.$inferSelect;
type ItemRow = typeof listItems.$inferSelect;

/** What a list made on the fly is called. */
const DEFAULT_TITLES: Record<ListKind, string> = { packing: 'Packing', todo: 'To-dos' };

/** Position keys compare byte by byte, as for plan items. */
const listOrder = sql`${lists.position} collate "C"`;
const itemOrder = sql`${listItems.position} collate "C"`;

const toList = (r: ListRow): TripList => ({
  id: r.id,
  tripId: r.tripId,
  title: r.title,
  kind: r.kind as ListKind,
  position: r.position,
  version: r.version,
  updatedAt: r.updatedAt.toISOString(),
});

const toListItem = (r: ItemRow, checkedBy: string[]): ListItem => ({
  id: r.id,
  listId: r.listId,
  tripId: r.tripId,
  text: r.text,
  scope: r.scope as ListItem['scope'],
  assigneeId: r.assigneeId,
  dueDate: r.dueDate,
  itemId: r.itemId,
  doneBy: r.doneBy,
  doneAt: r.doneAt?.toISOString() ?? null,
  checkedBy,
  position: r.position,
  createdBy: r.createdBy,
  version: r.version,
  updatedAt: r.updatedAt.toISOString(),
});

/** Who has ticked each "everyone" line, counting only people still on the trip. */
const checksFor = async (db: Db | Tx, tripId: string, itemIds: string[]) => {
  const byItem = new Map<string, string[]>();
  if (itemIds.length === 0) return byItem;
  const rows = await db
    .select({ listItemId: listItemChecks.listItemId, userId: listItemChecks.userId })
    .from(listItemChecks)
    .innerJoin(
      tripMembers,
      and(eq(tripMembers.userId, listItemChecks.userId), eq(tripMembers.tripId, tripId), isNull(tripMembers.leftAt)),
    )
    .where(inArray(listItemChecks.listItemId, itemIds))
    .orderBy(asc(listItemChecks.checkedAt));
  for (const r of rows) byItem.set(r.listItemId, [...(byItem.get(r.listItemId) ?? []), r.userId]);
  return byItem;
};

const hydrate = async (db: Db | Tx, row: ItemRow) =>
  toListItem(row, (await checksFor(db, row.tripId, [row.id])).get(row.id) ?? []);

const live = <T extends { deletedAt: unknown }>(row: T | undefined) => (row && !row.deletedAt ? row : undefined);

export const createListsService = (db: Db, redis: Redis) => {
  const loadList = async (listId: string) => {
    const [row] = await db.select().from(lists).where(eq(lists.id, listId));
    if (!live(row)) throw notFound('That list no longer exists');
    return row!;
  };
  const loadItem = async (id: string) => {
    const [row] = await db.select().from(listItems).where(eq(listItems.id, id));
    if (!live(row)) throw notFound('That’s no longer on the list');
    return row!;
  };

  /** An assignee must be on the trip, and a linked plan item must be in it. */
  const checkLinks = async (tripId: string, fields: { assigneeId?: string | null; itemId?: string | null }) => {
    if (fields.assigneeId) {
      const [member] = await db
        .select({ userId: tripMembers.userId })
        .from(tripMembers)
        .where(and(eq(tripMembers.tripId, tripId), eq(tripMembers.userId, fields.assigneeId), isNull(tripMembers.leftAt)));
      if (!member) throw badRequest('That person isn’t on this trip');
    }
    if (fields.itemId) {
      const [item] = await db
        .select({ id: items.id })
        .from(items)
        .where(and(eq(items.id, fields.itemId), eq(items.tripId, tripId), isNull(items.deletedAt)));
      if (!item) throw badRequest('That plan item isn’t on this trip');
    }
  };

  const lastListPosition = async (tx: Tx, tripId: string) => {
    const [last] = await tx
      .select({ position: lists.position })
      .from(lists)
      .where(and(eq(lists.tripId, tripId), isNull(lists.deletedAt)))
      .orderBy(desc(listOrder))
      .limit(1);
    return last?.position ?? null;
  };

  const announceItem = (item: ListItem, actorId: string, origin?: string) =>
    publishTripEvent(redis, {
      type: 'list_item.upserted',
      tripId: item.tripId,
      entityId: item.id,
      actorId,
      version: item.version,
      payload: item,
      originClientId: origin,
    });
  const announceList = (list: TripList, actorId: string, origin?: string) =>
    publishTripEvent(redis, {
      type: 'list.upserted',
      tripId: list.tripId,
      entityId: list.id,
      actorId,
      version: list.version,
      payload: list,
      originClientId: origin,
    });

  return {
    async overview(tripId: string, userId: string): Promise<ListsOverview> {
      await requireTripRole(db, tripId, userId, 'viewer');
      const listRows = await db
        .select()
        .from(lists)
        .where(and(eq(lists.tripId, tripId), isNull(lists.deletedAt)))
        .orderBy(asc(listOrder));
      const itemRows = await db
        .select()
        .from(listItems)
        .where(and(eq(listItems.tripId, tripId), isNull(listItems.deletedAt)))
        .orderBy(asc(itemOrder));
      const checks = await checksFor(
        db,
        tripId,
        itemRows.filter((r) => r.scope === 'everyone').map((r) => r.id),
      );
      return {
        lists: listRows.map(toList),
        items: itemRows.map((r) => toListItem(r, checks.get(r.id) ?? [])),
      };
    },

    /** Retrying with the same client-generated id returns the same list. */
    async createList(tripId: string, userId: string, input: CreateList, origin?: string) {
      await requireTripRole(db, tripId, userId, 'editor');
      const id = input.id ?? newId();
      const result = await db.transaction(async (tx) => {
        const [inserted] = await tx
          .insert(lists)
          .values({
            id,
            tripId,
            title: input.title,
            kind: input.kind,
            position: positionBetween(await lastListPosition(tx, tripId), null),
          })
          .onConflictDoNothing()
          .returning();
        if (!inserted) {
          const [existing] = await tx.select().from(lists).where(eq(lists.id, id));
          if (!existing || existing.tripId !== tripId) throw conflict('A list with that id already exists');
          return { list: toList(existing), created: false };
        }
        await tx.insert(changeLog).values({ tripId, entity: 'list', entityId: id, op: 'upsert', changedBy: userId });
        return { list: toList(inserted), created: true };
      });
      if (result.created) await announceList(result.list, userId, origin);
      return result;
    },

    async updateList(listId: string, userId: string, input: UpdateList, origin?: string) {
      const current = await loadList(listId);
      await requireTripRole(db, current.tripId, userId, 'editor');
      const { version, ...fields } = input;
      const changes = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));

      const updated = await db.transaction(async (tx) => {
        const [row] = await tx
          .update(lists)
          .set({ ...changes, version: sql`${lists.version} + 1` })
          .where(and(eq(lists.id, listId), eq(lists.version, version), isNull(lists.deletedAt)))
          .returning();
        if (!row) return null;
        await tx
          .insert(changeLog)
          .values({ tripId: row.tripId, entity: 'list', entityId: listId, op: 'upsert', changedBy: userId });
        return row;
      });
      if (!updated) {
        const latest = live((await db.select().from(lists).where(eq(lists.id, listId)))[0]);
        if (!latest) throw notFound('That list no longer exists');
        throw conflict('Someone changed this list while you were editing. Showing the latest version.', {
          current: toList(latest),
        });
      }
      const list = toList(updated);
      await announceList(list, userId, origin);
      return list;
    },

    /** Removes the list and everything on it. */
    async removeList(listId: string, userId: string, origin?: string) {
      const current = await loadList(listId);
      await requireTripRole(db, current.tripId, userId, 'editor');
      const deleted = await db.transaction(async (tx) => {
        const [row] = await tx
          .update(lists)
          .set({ deletedAt: new Date(), version: sql`${lists.version} + 1` })
          .where(and(eq(lists.id, listId), isNull(lists.deletedAt)))
          .returning({ version: lists.version });
        if (!row) return null;
        const gone = await tx
          .update(listItems)
          .set({ deletedAt: new Date(), version: sql`${listItems.version} + 1` })
          .where(and(eq(listItems.listId, listId), isNull(listItems.deletedAt)))
          .returning({ id: listItems.id });
        await tx.insert(changeLog).values([
          { tripId: current.tripId, entity: 'list', entityId: listId, op: 'delete', changedBy: userId },
          ...gone.map((g) => ({
            tripId: current.tripId,
            entity: 'list_item',
            entityId: g.id,
            op: 'delete',
            changedBy: userId,
          })),
        ]);
        return row;
      });
      if (!deleted) return;
      // One event: the app drops the list's lines along with it.
      await publishTripEvent(redis, {
        type: 'list.deleted',
        tripId: current.tripId,
        entityId: listId,
        actorId: userId,
        version: deleted.version,
        originClientId: origin,
      });
    },

    /**
     * Adds a line. Without a `listId` it goes on the trip's first list of that
     * kind, made on the spot if there isn't one, under a lock so two people
     * adding the first line at once still share one list.
     */
    async createItem(tripId: string, userId: string, input: CreateListItem, origin?: string) {
      await requireTripRole(db, tripId, userId, 'editor');
      await checkLinks(tripId, input);
      const id = input.id ?? newId();

      const result = await db.transaction(async (tx) => {
        const [existing] = await tx.select().from(listItems).where(eq(listItems.id, id));
        if (existing) {
          if (existing.tripId !== tripId || existing.createdBy !== userId) {
            throw conflict('Something with that id already exists');
          }
          return { item: await hydrate(tx, existing), created: false, newList: null };
        }

        let list: ListRow | undefined;
        let newList: ListRow | null = null;
        if (input.listId) {
          [list] = await tx
            .select()
            .from(lists)
            .where(and(eq(lists.id, input.listId), eq(lists.tripId, tripId), isNull(lists.deletedAt)));
          if (!list) throw notFound('That list no longer exists');
        } else {
          const kind = input.kind!;
          await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`lists:${tripId}:${kind}`}))`);
          [list] = await tx
            .select()
            .from(lists)
            .where(and(eq(lists.tripId, tripId), eq(lists.kind, kind), isNull(lists.deletedAt)))
            .orderBy(asc(listOrder))
            .limit(1);
          if (!list) {
            const [made] = await tx
              .insert(lists)
              .values({
                tripId,
                title: DEFAULT_TITLES[kind],
                kind,
                position: positionBetween(await lastListPosition(tx, tripId), null),
              })
              .returning();
            list = newList = made!;
            await tx
              .insert(changeLog)
              .values({ tripId, entity: 'list', entityId: list.id, op: 'upsert', changedBy: userId });
          }
        }

        const [last] = await tx
          .select({ position: listItems.position })
          .from(listItems)
          .where(and(eq(listItems.listId, list.id), isNull(listItems.deletedAt)))
          .orderBy(desc(itemOrder))
          .limit(1);
        const [inserted] = await tx
          .insert(listItems)
          .values({
            id,
            listId: list.id,
            tripId,
            text: input.text,
            scope: input.scope ?? 'shared',
            assigneeId: input.assigneeId ?? null,
            dueDate: input.dueDate ?? null,
            itemId: input.itemId ?? null,
            position: input.position ?? positionBetween(last?.position ?? null, null),
            createdBy: userId,
          })
          .onConflictDoNothing()
          .returning();
        if (!inserted) throw conflict('Something with that id already exists');
        await tx
          .insert(changeLog)
          .values({ tripId, entity: 'list_item', entityId: id, op: 'upsert', changedBy: userId });
        return { item: toListItem(inserted, []), created: true, newList };
      });

      if (result.newList) await announceList(toList(result.newList), userId, origin);
      if (result.created) await announceItem(result.item, userId, origin);
      return { item: result.item, created: result.created, list: result.newList ? toList(result.newList) : null };
    },

    async updateItem(id: string, userId: string, input: UpdateListItem, origin?: string) {
      const current = await loadItem(id);
      await requireTripRole(db, current.tripId, userId, 'editor');
      await checkLinks(current.tripId, input);
      const { version, ...fields } = input;
      const changes = Object.fromEntries(
        Object.entries(fields).filter(([, v]) => v !== undefined),
      ) as Partial<typeof listItems.$inferInsert>;
      // An "everyone" line has no group tick.
      if (changes.scope === 'everyone') Object.assign(changes, { doneBy: null, doneAt: null });

      const updated = await db.transaction(async (tx) => {
        const [row] = await tx
          .update(listItems)
          .set({ ...changes, version: sql`${listItems.version} + 1` })
          .where(and(eq(listItems.id, id), eq(listItems.version, version), isNull(listItems.deletedAt)))
          .returning();
        if (!row) return null;
        await tx
          .insert(changeLog)
          .values({ tripId: row.tripId, entity: 'list_item', entityId: id, op: 'upsert', changedBy: userId });
        return row;
      });
      if (!updated) {
        const latest = live((await db.select().from(listItems).where(eq(listItems.id, id)))[0]);
        if (!latest) throw notFound('That’s no longer on the list');
        throw conflict('Someone changed this while you were editing. Showing the latest version.', {
          current: await hydrate(db, latest),
        });
      }
      const item = await hydrate(db, updated);
      await announceItem(item, userId, origin);
      return item;
    },

    async removeItem(id: string, userId: string, origin?: string) {
      const current = await loadItem(id);
      await requireTripRole(db, current.tripId, userId, 'editor');
      const deleted = await db.transaction(async (tx) => {
        const [row] = await tx
          .update(listItems)
          .set({ deletedAt: new Date(), version: sql`${listItems.version} + 1` })
          .where(and(eq(listItems.id, id), isNull(listItems.deletedAt)))
          .returning({ version: listItems.version });
        if (!row) return null;
        await tx
          .insert(changeLog)
          .values({ tripId: current.tripId, entity: 'list_item', entityId: id, op: 'delete', changedBy: userId });
        return row;
      });
      if (!deleted) return;
      await publishTripEvent(redis, {
        type: 'list_item.deleted',
        tripId: current.tripId,
        entityId: id,
        actorId: userId,
        version: deleted.version,
        originClientId: origin,
      });
    },

    /**
     * Your own tick on an "everyone" line. Viewers can too: it's their own
     * packing. Ticks don't change the line's version, so they never make
     * someone's edit of the text conflict.
     */
    async check(id: string, userId: string, checked: boolean, origin?: string) {
      const current = await loadItem(id);
      await requireTripRole(db, current.tripId, userId, 'viewer');
      if (current.scope !== 'everyone') throw badRequest('This one is ticked once for the whole group');

      await db.transaction(async (tx) => {
        if (checked) {
          await tx.insert(listItemChecks).values({ listItemId: id, userId }).onConflictDoNothing();
        } else {
          await tx
            .delete(listItemChecks)
            .where(and(eq(listItemChecks.listItemId, id), eq(listItemChecks.userId, userId)));
        }
        await tx
          .insert(changeLog)
          .values({ tripId: current.tripId, entity: 'list_item', entityId: id, op: 'upsert', changedBy: userId });
      });
      const item = await hydrate(db, current);
      await announceItem(item, userId, origin);
      return item;
    },

    /** The group's one tick on a "shared" line. Changing what the group sees needs an editor. */
    async setDone(id: string, userId: string, done: boolean, origin?: string) {
      const current = await loadItem(id);
      await requireTripRole(db, current.tripId, userId, 'editor');
      if (current.scope !== 'shared') throw badRequest('Everyone ticks this one for themselves');

      const updated = await db.transaction(async (tx) => {
        const [row] = await tx
          .update(listItems)
          // Ticking it again keeps who did it first, and when.
          .set(
            done
              ? { doneBy: sql`coalesce(${listItems.doneBy}, ${userId}::uuid)`, doneAt: sql`coalesce(${listItems.doneAt}, now())` }
              : { doneBy: null, doneAt: null },
          )
          .where(and(eq(listItems.id, id), isNull(listItems.deletedAt)))
          .returning();
        if (!row) return null;
        await tx
          .insert(changeLog)
          .values({ tripId: row.tripId, entity: 'list_item', entityId: id, op: 'upsert', changedBy: userId });
        return row;
      });
      if (!updated) throw notFound('That’s no longer on the list');
      const item = await hydrate(db, updated);
      await announceItem(item, userId, origin);
      return item;
    },
  };
};
