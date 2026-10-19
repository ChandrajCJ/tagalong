import { and, eq, isNull } from 'drizzle-orm';
import { tripMembers, trips, users, type Db } from '@tagalong/db';
import type { Redis } from 'ioredis';
import type { ActivityJob, Jobs } from './jobs';

/** One thing that happened, as a line for the push: "Sam added Lunch to Day 2". */
export interface ActivityLine {
  actorName: string | null;
  /** The rest of the sentence after the actor's name ("added Lunch to Day 2"), or a whole one if there's no actor. */
  text: string;
  /** The screen a tap opens. */
  url: string;
  /** What several lines have in common, for the summary ("Day 2"). */
  group?: string;
}

/** Where a person's waiting lines for one trip and kind are kept until the push goes. */
export const activityKey = (kind: ActivityJob['kind'], tripId: string, userId: string) =>
  `activity:${kind}:${tripId}:${userId}`;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Day 2" inside the trip's dates, "13 Jun" outside them, "Anytime" for none. */
export const dayName = (date: string | null, tripStart: string | null) => {
  if (!date) return 'Anytime';
  if (tripStart) {
    const n = Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${tripStart}T00:00:00Z`)) / 86_400_000) + 1;
    if (n >= 1) return `Day ${n}`;
  }
  const [, m, d] = date.split('-').map(Number);
  return `${d} ${MONTHS[m! - 1]}`;
};

export type Notifier = ReturnType<typeof createNotifier>;

/**
 * Tells people about changes made by someone else: plan, money, to-dos and
 * the trip itself. Each change leaves a line for each person, and one job per
 * person waits a few seconds, so a burst becomes one push. Who wants what,
 * mute and "already looking at the app" are decided when the push is sent.
 * Never throws: a notification is never worth failing the change for.
 */
export const createNotifier = (db: Db, redis: Redis, jobs: Jobs) => ({
  async activity(
    kind: ActivityJob['kind'],
    tripId: string,
    actorId: string | null,
    line: Omit<ActivityLine, 'actorName'>,
    /** Only these people; everyone else on the trip when left out. */
    to?: string[],
  ) {
    try {
      const members = await db
        .select({ userId: tripMembers.userId })
        .from(tripMembers)
        .where(and(eq(tripMembers.tripId, tripId), isNull(tripMembers.leftAt)));
      const onTrip = new Set(members.map((m) => m.userId));
      const recipients = [...new Set(to ?? onTrip)].filter((id) => id !== actorId && onTrip.has(id));
      if (recipients.length === 0) return;

      const [actor] = actorId ? await db.select({ name: users.displayName }).from(users).where(eq(users.id, actorId)) : [];
      const entry = JSON.stringify({ actorName: actor?.name ?? null, ...line } satisfies ActivityLine);
      const batch = redis.multi();
      for (const userId of recipients) {
        const key = activityKey(kind, tripId, userId);
        batch.rpush(key, entry).expire(key, 2 * 24 * 60 * 60);
      }
      await batch.exec();
      await jobs.notifyActivity(kind, tripId, recipients);
    } catch (err) {
      console.error('Could not queue a notification', kind, tripId, err);
    }
  },

  /** The trip's first day, for naming days in lines ("Day 2"). */
  async tripStart(tripId: string) {
    const [trip] = await db.select({ start: trips.startDate }).from(trips).where(eq(trips.id, tripId));
    return trip?.start ?? null;
  },
});
