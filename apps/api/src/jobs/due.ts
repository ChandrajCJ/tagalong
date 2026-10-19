import { and, between, eq, isNotNull, isNull } from 'drizzle-orm';
import { listItems, lists, trips, type Db } from '@tagalong/db';
import { wallClock } from '@tagalong/shared';
import type { Redis } from 'ioredis';
import type { Notifier } from '../lib/notifier';

/** The hourly job that reminds people of to-dos due tomorrow. */
export const DUE_JOB = 'due-tomorrow';

const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Not before this hour on the trip's clock: nobody wants a to-do at midnight. */
const FROM_HOUR = 9;

/**
 * "Due tomorrow: Book Sintra tickets", to whoever a to-do is on, the morning
 * before it's due on the trip's own calendar. The job runs hourly; each to-do
 * is announced once per due date, on the first run from 9 am there.
 */
export const queueDueTomorrow = async (
  { db, redis, notifier }: { db: Db; redis: Redis; notifier: Notifier },
  now = new Date(),
) => {
  // Every time zone's "tomorrow" falls within a day either side of UTC's.
  const utcToday = now.toISOString().slice(0, 10);
  const candidates = await db
    .select({
      id: listItems.id,
      tripId: listItems.tripId,
      text: listItems.text,
      dueDate: listItems.dueDate,
      assigneeId: listItems.assigneeId,
      timezone: trips.timezone,
    })
    .from(listItems)
    .innerJoin(lists, eq(lists.id, listItems.listId))
    .innerJoin(trips, eq(trips.id, listItems.tripId))
    .where(
      and(
        eq(lists.kind, 'todo'),
        isNull(listItems.deletedAt),
        isNull(lists.deletedAt),
        isNull(trips.deletedAt),
        isNull(listItems.doneAt),
        isNotNull(listItems.assigneeId),
        between(listItems.dueDate, utcToday, addDays(utcToday, 2)),
      ),
    );

  let queued = 0;
  for (const todo of candidates) {
    const local = wallClock(now.toISOString(), todo.timezone ?? 'UTC');
    if (todo.dueDate !== addDays(local.date, 1) || Number(local.time.slice(0, 2)) < FROM_HOUR) continue;
    const fresh = await redis.set(`due:${todo.id}:${todo.dueDate}`, '1', 'EX', 3 * 86_400, 'NX');
    if (!fresh) continue;
    await notifier.activity('todos', todo.tripId, null, { text: `Due tomorrow: ${todo.text}`, url: `/trips/${todo.tripId}/lists` }, [
      todo.assigneeId!,
    ]);
    queued += 1;
  }
  return { queued };
};
