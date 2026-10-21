import { shareUntil, type ShareChoice } from '@tagalong/shared';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { useEffect, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { ApiError, request } from './api';
import { secureStorage } from './storage';

/**
 * Sharing my location with one trip for a while (ADR 027). Nothing happens
 * unless I start it; it stops when I say, when the time runs out, or when I'm
 * no longer on the trip. While the app is open it uses the phone's location
 * directly; "keep sharing while closed" adds Android's foreground service,
 * with its own notification, and needs "Allow all the time".
 */

export interface Sharing {
  tripId: string;
  tripName: string;
  until: string;
  /** Carrying on while the app is closed (the foreground service is running). */
  background: boolean;
}

const KEY = 'live-location';
export const LOCATION_TASK = 'tagalong-live-location';
/** An update every 60 s or every 50 m, whichever comes later, at "balanced" accuracy. */
const UPDATES = { accuracy: Location.Accuracy.Balanced, timeInterval: 60_000, distanceInterval: 50 };

let current: Sharing | null = null;
let loaded = false;
const listeners = new Set<(s: Sharing | null) => void>();
let watcher: { remove(): void } | null = null;
let webWatch: number | null = null;
let stopTimer: ReturnType<typeof setTimeout> | null = null;
let lastSent = 0;

const announce = () => listeners.forEach((l) => l(current));

const save = async (next: Sharing | null) => {
  current = next;
  await secureStorage.set(KEY, next ? JSON.stringify(next) : null);
  announce();
};

const load = async () => {
  if (loaded) return current;
  loaded = true;
  const raw = await secureStorage.get(KEY);
  try {
    current = raw ? (JSON.parse(raw) as Sharing) : null;
  } catch {
    current = null;
  }
  return current;
};

/** Sends one position. Out of time, or off the trip: sharing stops. */
const send = async (coords: { latitude: number; longitude: number; accuracy?: number | null }) => {
  const sharing = await load();
  if (!sharing) return;
  if (Date.parse(sharing.until) <= Date.now()) return void stopSharing();
  try {
    lastSent = Date.now();
    await request(`/trips/${sharing.tripId}/location`, {
      method: 'POST',
      body: { latitude: coords.latitude, longitude: coords.longitude, accuracy: coords.accuracy ?? null, until: sharing.until },
    });
  } catch (e) {
    // 429 just means too soon; 404 or 403 means I'm not on the trip any more.
    if (e instanceof ApiError && (e.status === 404 || e.status === 403)) await stopSharing({ quiet: true });
  }
};

// Background updates arrive here, even with the app in the background. Defined once, at the top level.
if (Platform.OS !== 'web' && !TaskManager.isTaskDefined(LOCATION_TASK)) {
  TaskManager.defineTask<{ locations: Location.LocationObject[] }>(LOCATION_TASK, async ({ data, error }) => {
    if (error || !data?.locations?.length) return;
    const latest = data.locations.at(-1)!;
    await send(latest.coords);
  });
}

const startWatching = async (sharing: Sharing) => {
  stopWatching();
  stopTimer = setTimeout(() => void stopSharing(), Math.max(0, Date.parse(sharing.until) - Date.now()));
  if (Platform.OS === 'web') {
    if (!('geolocation' in navigator)) return;
    webWatch = navigator.geolocation.watchPosition(
      (p) => {
        // The browser can report often; one a minute is plenty.
        if (Date.now() - lastSent >= 60_000) void send(p.coords);
      },
      () => undefined,
      { enableHighAccuracy: false, maximumAge: 60_000 },
    );
    return;
  }
  // The background task already reports while the app is open, too.
  if (sharing.background) return;
  watcher = await Location.watchPositionAsync(UPDATES, (p) => void send(p.coords));
};

const stopWatching = () => {
  watcher?.remove();
  watcher = null;
  if (webWatch !== null) navigator.geolocation.clearWatch(webWatch);
  webWatch = null;
  if (stopTimer) clearTimeout(stopTimer);
  stopTimer = null;
};

const backgroundRunning = async () =>
  Platform.OS !== 'web' && (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK).catch(() => false));

/**
 * Starts sharing with a trip for an hour, four hours or the rest of today.
 * Asks for location access first; "keep sharing while closed" also asks for
 * "Allow all the time", and falls back to only while open if that's refused.
 */
export const startSharing = async (
  trip: { id: string; name: string },
  choice: ShareChoice,
  whileClosed: boolean,
): Promise<{ background: boolean } | { error: string }> => {
  let coords: { latitude: number; longitude: number; accuracy?: number | null } | null = null;
  if (Platform.OS === 'web') {
    if (!('geolocation' in navigator)) return { error: 'This browser can’t share a location.' };
    coords = await new Promise((resolve) =>
      navigator.geolocation.getCurrentPosition(
        (p) => resolve(p.coords),
        () => resolve(null),
        { enableHighAccuracy: false, timeout: 15_000, maximumAge: 60_000 },
      ),
    );
    if (!coords) return { error: 'Allow location access in the browser to share where you are.' };
  } else {
    const fg = await Location.requestForegroundPermissionsAsync();
    if (!fg.granted) return { error: 'Allow location access to share where you are. You can change this in the phone’s settings.' };
  }

  if (current && current.tripId !== trip.id) await stopSharing();
  const until = shareUntil(choice, new Date(), Intl.DateTimeFormat().resolvedOptions().timeZone);

  let background = false;
  if (whileClosed && Platform.OS !== 'web') {
    const bg = await Location.requestBackgroundPermissionsAsync().catch(() => null);
    if (bg?.granted) {
      try {
        await Location.startLocationUpdatesAsync(LOCATION_TASK, {
          ...UPDATES,
          pausesUpdatesAutomatically: false,
          showsBackgroundLocationIndicator: true,
          foregroundService: {
            notificationTitle: 'Tagalong is sharing your location',
            notificationBody: `With ${trip.name}. Open the app to stop.`,
            killServiceOnDestroy: false,
          },
        });
        background = true;
      } catch {
        // Not in Expo Go, or refused by the system: share only while the app is open.
      }
    }
  }

  const sharing: Sharing = { tripId: trip.id, tripName: trip.name, until, background };
  await save(sharing);
  await startWatching(sharing);
  // The first position goes straight away, so the pin appears now.
  if (!coords && Platform.OS !== 'web') {
    coords = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
      .then((p) => p.coords)
      .catch(() => null);
  }
  if (coords) await send(coords);
  return { background };
};

/** Stops sharing: the foreground service and watcher end, and the trip is told. */
export const stopSharing = async ({ quiet = false }: { quiet?: boolean } = {}) => {
  const sharing = await load();
  stopWatching();
  if (await backgroundRunning()) await Location.stopLocationUpdatesAsync(LOCATION_TASK).catch(() => undefined);
  await save(null);
  if (sharing && !quiet) await request(`/trips/${sharing.tripId}/location`, { method: 'DELETE' }).catch(() => undefined);
};

/** Picks sharing back up when the app opens: the watcher restarts, or an expired share ends. */
export const resumeSharing = async () => {
  const sharing = await load();
  if (!sharing) return;
  if (Date.parse(sharing.until) <= Date.now()) return stopSharing();
  // The service may have been stopped by the system; then carry on only while open.
  if (sharing.background && !(await backgroundRunning())) await save({ ...sharing, background: false });
  await startWatching(current!);
};

/** What I'm sharing, if anything, kept live for banners and buttons. */
export function useSharing() {
  const [state, setState] = useState<Sharing | null>(current);
  useEffect(() => {
    listeners.add(setState);
    void load().then(setState);
    return () => void listeners.delete(setState);
  }, []);
  return state;
}

/** Keeps sharing going across app restarts, and checks it on coming back to the app. */
export function useSharingLifecycle() {
  useEffect(() => {
    void resumeSharing();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void resumeSharing();
    });
    return () => sub.remove();
  }, []);
}
