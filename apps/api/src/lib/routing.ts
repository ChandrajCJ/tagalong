import type { RouteLine, TravelMode } from '@tagalong/shared';
import type { Point } from './geo';

/**
 * Travel times and distances on real roads and paths, from OSRM. By default
 * the FOSSGIS servers (routing.openstreetmap.de): free, keyless and fair-use,
 * so answers are cached hard and we say who we are. Swapped for a fake in
 * tests, which must never depend on the network.
 */
export interface Routing {
  /** The way through `points` in order: one leg per pair next to each other. */
  route(mode: TravelMode, points: Point[]): Promise<{ legs: { distanceM: number; durationS: number }[]; geometry: RouteLine }>;
  /** Every point to every other: `durations[i][j]` seconds from i to j. */
  table(mode: TravelMode, points: Point[]): Promise<{ durations: number[][] }>;
}

export interface RoutingConfig {
  baseUrl: string;
  userAgent: string;
  /** Give up after this long and fall back to estimates. */
  timeoutMs?: number;
}

/** FOSSGIS runs one server per way of travelling. */
const PROFILE: Record<TravelMode, string> = { foot: 'routed-foot', car: 'routed-car', bike: 'routed-bike' };

export const osrmRouting = ({ baseUrl, userAgent, timeoutMs = 5000 }: RoutingConfig): Routing => {
  const get = async <T extends { code?: string }>(mode: TravelMode, service: 'route' | 'table', points: Point[], params: Record<string, string>) => {
    // OSRM wants longitude first; the profile name in the path is ignored by the server.
    const coords = points.map((p) => `${p.longitude.toFixed(6)},${p.latitude.toFixed(6)}`).join(';');
    const url = `${baseUrl.replace(/\/$/, '')}/${PROFILE[mode]}/${service}/v1/driving/${coords}?${new URLSearchParams(params)}`;
    const res = await fetch(url, { headers: { 'user-agent': userAgent, accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) throw new Error(`Routing answered ${res.status}`);
    const body = (await res.json()) as T;
    if (body.code !== 'Ok') throw new Error(`Routing answered ${body.code}`);
    return body;
  };

  return {
    async route(mode, points) {
      type Answer = { code?: string; routes: { legs: { distance: number; duration: number }[]; geometry: RouteLine }[] };
      const body = await get<Answer>(mode, 'route', points, { overview: 'full', geometries: 'geojson', steps: 'false' });
      const best = body.routes[0];
      if (!best) throw new Error('Routing found no way through');
      return {
        legs: best.legs.map((l) => ({ distanceM: Math.round(l.distance), durationS: Math.round(l.duration) })),
        geometry: best.geometry,
      };
    },

    async table(mode, points) {
      type Answer = { code?: string; durations: (number | null)[][] };
      const body = await get<Answer>(mode, 'table', points, { annotations: 'duration' });
      // null means no way between the two (an island, say): treat it as very far.
      return { durations: body.durations.map((row) => row.map((d) => (d === null ? 1e9 : Math.round(d)))) };
    },
  };
};
