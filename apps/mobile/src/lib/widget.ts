import { BookingList, ItemList, MyTrips, Trip, type WidgetTrip } from '@tagalong/shared';
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { widgetsAvailable } from '@/widget/native';
import { clearSnapshot, currentView, saveSnapshot } from '@/widget/snapshot';
import { request } from './api';
import { titleOf } from './bookings';

const DAY_MS = 86_400_000;
/** Trips that start within this many days get their stops and bookings saved too. */
const DETAIL_DAYS = 14;

/** Redraws every widget on the home screen from what's saved now. */
const redraw = async () => {
  const [{ requestWidgetUpdate }, { renderTripWidget, SMALL_WIDGET, MEDIUM_WIDGET }] = await Promise.all([
    import('react-native-android-widget'),
    import('@/widget/trip-widget'),
  ]);
  const view = await currentView();
  await Promise.all(
    [SMALL_WIDGET, MEDIUM_WIDGET].map((widgetName) =>
      requestWidgetUpdate({ widgetName, renderWidget: () => renderTripWidget(widgetName, view) }),
    ),
  );
};

/** The next few trips, with today's stops and bookings for one that's close. */
const tripsForWidget = async (): Promise<WidgetTrip[]> => {
  const { trips } = await request('/trips', { schema: MyTrips });
  const yesterday = new Date(Date.now() - DAY_MS).toISOString().slice(0, 10);
  const soon = new Date(Date.now() + DETAIL_DAYS * DAY_MS).toISOString().slice(0, 10);
  const upcoming = trips
    .filter((t) => !t.archived && t.startDate && (t.endDate ?? t.startDate) >= yesterday)
    .sort((a, b) => (a.startDate! < b.startDate! ? -1 : 1))
    .slice(0, 3);
  return Promise.all(
    upcoming.map(async (t): Promise<WidgetTrip> => {
      const close = t.startDate! <= soon;
      const [trip, plan, bookings] = await Promise.all([
        request(`/trips/${t.id}`, { schema: Trip }),
        close ? request(`/trips/${t.id}/items`, { schema: ItemList }) : null,
        close ? request(`/trips/${t.id}/bookings`, { schema: BookingList }) : null,
      ]);
      return {
        id: t.id,
        name: t.name,
        coverColor: t.coverColor,
        startDate: t.startDate,
        endDate: t.endDate,
        timezone: trip.timezone,
        readiness: t.readiness,
        stops: (plan?.items ?? []).flatMap((i) =>
          i.date && i.startTime ? [{ id: i.id, date: i.date, startTime: i.startTime, title: i.title }] : [],
        ),
        bookings: (bookings?.bookings ?? []).flatMap((b) => (b.startsAt ? [{ title: titleOf(b), startsAt: b.startsAt }] : [])),
      };
    }),
  );
};

let running = false;

/** Saves the widget's facts and redraws it. Only on Android builds that have the widget; quiet on failure. */
export const syncWidget = async () => {
  if (!widgetsAvailable() || running) return;
  running = true;
  try {
    await saveSnapshot(await tripsForWidget());
    await redraw();
  } catch {
    // Offline: the widget keeps what it last had.
  } finally {
    running = false;
  }
};

let timer: ReturnType<typeof setTimeout> | null = null;

/** After plan, packing or booking changes: sync once things settle. */
export const requestWidgetSync = () => {
  if (!widgetsAvailable()) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void syncWidget();
  }, 5_000);
};

/** Signed out: the widget forgets the trips. */
export const clearWidget = async () => {
  if (!widgetsAvailable()) return;
  await clearSnapshot().catch(() => undefined);
  await redraw().catch(() => undefined);
};

/** Keeps the widget up to date while signed in: on opening the app and on coming back to it. */
export function useWidgetSync() {
  useEffect(() => {
    if (!widgetsAvailable()) return;
    void syncWidget();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void syncWidget();
    });
    return () => sub.remove();
  }, []);
}
