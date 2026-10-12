import { DayRoute, defaultMode, TRAVEL_MODES, type ItineraryItem, type TravelMode } from '@tagalong/shared';
import { useEffect, useMemo, useState } from 'react';
import { request } from './api';
import { secureStorage } from './storage';

export const MODE_META: Record<TravelMode, { label: string; emoji: string; doing: string; by: string }> = {
  foot: { label: 'Walk', emoji: '🚶', doing: 'walking', by: 'on foot' },
  car: { label: 'Drive', emoji: '🚗', doing: 'driving', by: 'by car' },
  bike: { label: 'Cycle', emoji: '🚲', doing: 'cycling', by: 'by bike' },
};

/** "4 min", "1 h 5 min". */
export const formatDuration = (seconds: number) => {
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
};

/** "900 m", "1.2 km", "14 km". */
export const formatDistance = (metres: number) => {
  if (metres < 1000) return `${Math.round(metres / 50) * 50 || 50} m`;
  const km = metres / 1000;
  return `${km < 10 ? km.toFixed(1) : Math.round(km)} km`;
};

const located = (items: ItineraryItem[]) =>
  items.filter((i) => i.latitude !== null && i.longitude !== null) as (ItineraryItem & { latitude: number; longitude: number })[];

/**
 * How someone gets around on a day, remembered on this device per day.
 * Until they choose, it's walking for a compact day and driving otherwise.
 */
export function useRouteMode(tripId: string, date: string | null, dayItems: ItineraryItem[]) {
  const [chosen, setChosen] = useState<TravelMode | null>(null);
  // Keychain keys allow only letters, digits, ".", "-" and "_".
  const key = date ? `route-mode.${tripId}.${date}` : null;

  useEffect(() => {
    setChosen(null);
    if (!key) return;
    let live = true;
    void secureStorage.get(key).then((saved) => {
      if (live && saved && (TRAVEL_MODES as readonly string[]).includes(saved)) setChosen(saved as TravelMode);
    });
    return () => {
      live = false;
    };
  }, [key]);

  const fallback = useMemo(() => defaultMode(located(dayItems)), [dayItems]);
  const choose = (mode: TravelMode) => {
    setChosen(mode);
    if (key) void secureStorage.set(key, mode);
  };
  return [chosen ?? fallback, choose] as const;
}

/**
 * Travel between the day's stops, refetched whenever the located stops or
 * their order change. Null while loading, or when there's nothing to join up.
 */
export function useDayRoute(tripId: string, date: string | null, mode: TravelMode, dayItems: ItineraryItem[]) {
  const [route, setRoute] = useState<DayRoute | null>(null);
  const stops = located(dayItems);
  // Which stops, where, and in what order. The version too: after a drag the
  // order changes here first, and the server's copy only once it's saved.
  const signature = dayItems.map((i) => `${i.id}.${i.version}@${i.latitude ?? ''},${i.longitude ?? ''}`).join(';');
  const enough = stops.length >= 2;

  useEffect(() => {
    if (!date || !enough) return setRoute(null);
    let live = true;
    request(`/trips/${tripId}/days/${date}/route?mode=${mode}`, { schema: DayRoute })
      .then((r) => live && setRoute(r))
      .catch(() => live && setRoute(null));
    return () => {
      live = false;
    };
  }, [tripId, date, mode, signature, enough]);

  return route;
}
