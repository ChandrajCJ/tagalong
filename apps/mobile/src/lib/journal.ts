import { JournalDay, openMeteoDaily, placeSegments, type JournalMood, type JournalPlace, type JournalVisibility, type Trip, type WeatherDay } from '@tagalong/shared';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Platform } from 'react-native';
import { ApiError, request } from './api';
import { addDays } from './dates';
import { useTripRealtime } from './realtime';

/** What each mood means, for screen readers and the picker. */
export const MOOD_LABELS: Record<JournalMood, string> = {
  '😍': 'Loved it',
  '🙂': 'Good',
  '😴': 'Tired',
  '🥵': 'Hot',
  '🌧️': 'Rainy',
  '🤯': 'Mind-blown',
};

/** One day page, kept fresh: fetched on focus and again whenever someone changes an entry on that day. */
export const useJournalDay = (tripId: string | undefined, date: string | undefined) => {
  const [day, setDay] = useState<JournalDay | null>(null);
  const [error, setError] = useState<string>();

  const load = useCallback(async () => {
    if (!tripId || !date) return;
    try {
      setDay(await request(`/trips/${tripId}/journal/${date}`, { schema: JournalDay }));
      setError(undefined);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Couldn’t load this day');
    }
  }, [tripId, date]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  useTripRealtime(tripId, (m) => {
    if (m.kind === 'reconnected') return void load();
    if (m.kind !== 'event') return;
    const { type, payload } = m.event;
    if (type === 'journal.updated' && (payload as { date?: string } | undefined)?.date === date) void load();
  });

  return { day, setDay, error, reload: load };
};

/** A half-written entry, kept on this device until it's sent. */
export interface JournalDraft {
  body: string;
  mood: JournalMood | null;
  visibility: JournalVisibility;
  mediaIds: string[];
  place: JournalPlace | null;
}

const draftKey = (tripId: string, date: string) => `journal-draft-${tripId}-${date}`;

/**
 * Drafts live in a small file on the phone (the keychain is too small for a
 * long entry) or the browser's localStorage. Losing one is never worse than
 * not having it, so every failure is quiet.
 */
export const drafts = {
  async get(tripId: string, date: string): Promise<JournalDraft | null> {
    try {
      const raw =
        Platform.OS === 'web'
          ? window.localStorage.getItem(draftKey(tripId, date))
          : await (async () => {
              const FileSystem = await import('expo-file-system/legacy');
              const uri = `${FileSystem.documentDirectory}${draftKey(tripId, date)}.json`;
              return (await FileSystem.getInfoAsync(uri)).exists ? FileSystem.readAsStringAsync(uri) : null;
            })();
      return raw ? (JSON.parse(raw) as JournalDraft) : null;
    } catch {
      return null;
    }
  },
  async set(tripId: string, date: string, draft: JournalDraft | null) {
    try {
      if (Platform.OS === 'web') {
        if (draft) window.localStorage.setItem(draftKey(tripId, date), JSON.stringify(draft));
        else window.localStorage.removeItem(draftKey(tripId, date));
        return;
      }
      const FileSystem = await import('expo-file-system/legacy');
      const uri = `${FileSystem.documentDirectory}${draftKey(tripId, date)}.json`;
      if (draft) await FileSystem.writeAsStringAsync(uri, JSON.stringify(draft));
      else await FileSystem.deleteAsync(uri, { idempotent: true });
    } catch {
      // Kept on screen only.
    }
  },
};

/**
 * The weather on one day, asked of Open-Meteo by the phone: what it actually
 * was once it's past (the archive lags a few days, so the forecast service
 * covers the last week), and the forecast while it's upcoming. Null beyond
 * the forecast's two weeks.
 */
export const dayWeather = async (
  centre: { latitude: number; longitude: number },
  date: string,
  today: string,
): Promise<WeatherDay | null> => {
  if (date > addDays(today, 15)) return null;
  const kind = date < addDays(today, -6) ? 'archive' : 'forecast';
  const { days } = await openMeteoDaily(fetch, centre, kind, date, date);
  return days[0] ?? null;
};

/**
 * The weather each day of a trip actually had, for the recap: each stretch
 * of days at its own place. Days at a place not on the map are left out.
 */
export const tripPastWeather = async (trip: Trip, today: string): Promise<Map<string, WeatherDay>> => {
  const byDate = new Map<string, WeatherDay>();
  if (!trip.startDate) return byDate;
  const end = trip.endDate ?? trip.startDate;
  const places = trip.places.map((p) => ({
    destination: p.destination,
    latitude: p.location?.latitude ?? null,
    longitude: p.location?.longitude ?? null,
    startDate: p.startDate,
    endDate: p.endDate,
  }));
  const segments =
    places.length > 0
      ? placeSegments(places, trip.startDate, end).map((s) => ({ centre: s.place, from: s.from, to: s.to }))
      : trip.location
        ? [{ centre: trip.location, from: trip.startDate, to: end }]
        : [];
  await Promise.all(
    segments.map(async ({ centre, from, to }) => {
      if (centre.latitude == null || centre.longitude == null) return;
      const kind = to < addDays(today, -6) ? 'archive' : 'forecast';
      const { days } = await openMeteoDaily(fetch, { latitude: centre.latitude, longitude: centre.longitude }, kind, from, to).catch(() => ({ days: [] as WeatherDay[] }));
      for (const d of days) byDate.set(d.date, d);
    }),
  );
  return byDate;
};
