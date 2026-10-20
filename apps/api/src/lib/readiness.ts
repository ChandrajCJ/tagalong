import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { listItemChecks, listItems, lists, type Db } from '@tagalong/db';
import type { Readiness } from '@tagalong/shared';

/**
 * "4 of 18 packed · 2 to-dos open" for each trip, from where `userId` stands:
 * their own ticks on "everyone" lines, and the group's tick on shared ones.
 * Trips without any list lines are left out.
 */
export const readinessFor = async (db: Db, userId: string, tripIds: string[]): Promise<Map<string, Readiness>> => {
  const result = new Map<string, Readiness>();
  if (tripIds.length === 0) return result;
  const done = sql<number>`(count(*) filter (where
    (${listItems.scope} = 'shared' and ${listItems.doneAt} is not null)
    or (${listItems.scope} = 'everyone' and exists (
      select 1 from ${listItemChecks} c where c.list_item_id = ${listItems.id} and c.user_id = ${userId}
    ))))::int`;
  const rows = await db
    .select({ tripId: listItems.tripId, kind: lists.kind, total: sql<number>`count(*)::int`, done })
    .from(listItems)
    .innerJoin(lists, eq(lists.id, listItems.listId))
    .where(and(inArray(listItems.tripId, tripIds), isNull(listItems.deletedAt), isNull(lists.deletedAt)))
    .groupBy(listItems.tripId, lists.kind);
  for (const r of rows) {
    const entry = result.get(r.tripId) ?? { packed: 0, packingTotal: 0, todosOpen: 0 };
    if (r.kind === 'packing') {
      entry.packed = r.done;
      entry.packingTotal = r.total;
    } else {
      entry.todosOpen = r.total - r.done;
    }
    result.set(r.tripId, entry);
  }
  return result;
};
