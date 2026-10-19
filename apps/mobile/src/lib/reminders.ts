import {
  BookingList,
  diffReminders,
  itemStartsAt,
  ItemList,
  MyTrips,
  NotificationPrefs,
  PUSH_CHANNELS,
  Trip,
  wantedReminders,
  type ReminderStop,
} from '@tagalong/shared';
import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';
import { request } from './api';
import { titleOf } from './bookings';
import { notifications } from './push';

/** Reminders are ours when their id starts with this; the rest of the id is the reminder's key. */
const PREFIX = 'reminder:';
const HORIZON_DAYS = 7;
const DAY_MS = 86_400_000;

/** The web app can't schedule anything on the phone, so it has no reminders. */
export const remindersAvailable = Platform.OS !== 'web';

const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Timed stops and bookings in my trips over the next week, with when each starts. */
const upcomingStops = async (now: Date): Promise<ReminderStop[]> => {
  const { trips } = await request('/trips', { schema: MyTrips });
  const from = isoDay(now.getTime() - DAY_MS);
  const to = isoDay(now.getTime() + (HORIZON_DAYS + 1) * DAY_MS);
  // Only trips happening this week; one with no dates can't have a timed stop on a day yet.
  const soon = trips.filter((t) => !t.archived && t.startDate && t.startDate <= to && (t.endDate ?? t.startDate) >= from);
  const lists = await Promise.all(
    soon.map(async (summary): Promise<ReminderStop[]> => {
      const [trip, plan, bookings] = await Promise.all([
        request(`/trips/${summary.id}`, { schema: Trip }),
        request(`/trips/${summary.id}/items`, { schema: ItemList }),
        request(`/trips/${summary.id}/bookings`, { schema: BookingList }),
      ]);
      const zone = trip.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
      const items = plan.items.flatMap((i): ReminderStop[] =>
        i.date && i.startTime && i.date >= from && i.date <= to
          ? [
              {
                id: i.id,
                kind: 'item',
                tripId: trip.id,
                tripName: trip.name,
                title: i.title,
                startsAt: itemStartsAt(i.date, i.startTime, zone),
                type: i.type,
                placeName: i.placeName,
              },
            ]
          : [],
      );
      const booked = bookings.bookings.flatMap((b): ReminderStop[] =>
        b.startsAt
          ? [
              {
                id: b.id,
                kind: 'booking',
                tripId: trip.id,
                tripName: trip.name,
                title: titleOf(b),
                startsAt: b.startsAt,
                type: b.type,
                placeName: null,
                itemId: b.itemId,
              },
            ]
          : [],
      );
      return [...items, ...booked];
    }),
  );
  return lists.flat();
};

let running: Promise<void> | null = null;
let again = false;

/**
 * Makes the phone's scheduled reminders match the plan: adds new ones,
 * cancels ones for stops that moved or went. Safe to call often; calls that
 * arrive while one is running are folded into one more run.
 */
export const syncReminders = (): Promise<void> => {
  if (!remindersAvailable) return Promise.resolve();
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    try {
      const N = await notifications();
      const scheduled = (await N.getAllScheduledNotificationsAsync())
        .map((n) => n.identifier)
        .filter((id) => id.startsWith(PREFIX));
      const prefs = await request('/me/notifications', { schema: NotificationPrefs });
      const { granted } = await N.getPermissionsAsync();
      const now = new Date();
      const wanted =
        prefs.reminders && granted ? wantedReminders(await upcomingStops(now), { leadMinutes: prefs.reminderMinutes, now, horizonDays: HORIZON_DAYS }) : [];
      const { schedule, cancel } = diffReminders(
        wanted,
        scheduled.map((id) => id.slice(PREFIX.length)),
      );
      await Promise.all(cancel.map((key) => N.cancelScheduledNotificationAsync(`${PREFIX}${key}`)));
      for (const r of schedule) {
        await N.scheduleNotificationAsync({
          identifier: `${PREFIX}${r.key}`,
          content: { title: r.title, body: r.body, data: { url: r.url } },
          trigger: { type: N.SchedulableTriggerInputTypes.DATE, date: new Date(r.fireAt), channelId: PUSH_CHANNELS.reminders.id },
        });
      }
    } catch {
      // Offline or signed out: what's scheduled stays until the next try.
    } finally {
      running = null;
      if (again) {
        again = false;
        void syncReminders();
      }
    }
  })();
  return running;
};

let timer: ReturnType<typeof setTimeout> | null = null;

/** After plan changes: sync once things settle, not on every keystroke's event. */
export const requestReminderSync = () => {
  if (!remindersAvailable) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void syncReminders();
  }, 5_000);
};

/** Keeps reminders in step while signed in: on opening the app and on coming back to it. */
export function useReminderSync() {
  useEffect(() => {
    if (!remindersAvailable) return;
    void syncReminders();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void syncReminders();
    });
    return () => sub.remove();
  }, []);
}
