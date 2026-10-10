/**
 * Turning photo coordinates into places for the map: photos taken close
 * together become one pin, and the map opens framed around all of them.
 * Pure functions, so they're tested here rather than on a phone.
 */

export interface Located {
  id: string;
  latitude: number;
  longitude: number;
  /** "2026-06-12T18:30:00", or null when the camera didn't say. */
  takenAt: string | null;
}

export interface Place {
  /** The first photo's id: stable while photos are only added. */
  id: string;
  latitude: number;
  longitude: number;
  photoIds: string[];
  /** The earliest and latest times taken, for "Sat 12 Jun – Mon 14 Jun". */
  from: string | null;
  to: string | null;
}

const EARTH_RADIUS_M = 6_371_000;
const rad = (deg: number) => (deg * Math.PI) / 180;

/** Distance between two points on the globe, in metres. */
export const metresBetween = (
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
) => {
  const dLat = rad(b.latitude - a.latitude);
  const dLng = rad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
};

/**
 * Groups photos taken within `radius` metres of each other. Greedy and in
 * time order, which is plenty for one trip's photos and keeps a place's
 * id stable as new photos arrive.
 */
export const clusterPlaces = (points: Located[], radius = 250): Place[] => {
  const ordered = [...points].sort((a, b) =>
    (a.takenAt ?? '￿').localeCompare(b.takenAt ?? '￿') || a.id.localeCompare(b.id),
  );
  const places: (Place & { sumLat: number; sumLng: number })[] = [];

  for (const p of ordered) {
    let nearest: (typeof places)[number] | undefined;
    let best = Infinity;
    for (const place of places) {
      const d = metresBetween(place, p);
      if (d <= radius && d < best) {
        best = d;
        nearest = place;
      }
    }
    if (nearest) {
      nearest.photoIds.push(p.id);
      nearest.sumLat += p.latitude;
      nearest.sumLng += p.longitude;
      nearest.latitude = nearest.sumLat / nearest.photoIds.length;
      nearest.longitude = nearest.sumLng / nearest.photoIds.length;
      if (p.takenAt) {
        if (!nearest.from || p.takenAt < nearest.from) nearest.from = p.takenAt;
        if (!nearest.to || p.takenAt > nearest.to) nearest.to = p.takenAt;
      }
    } else {
      places.push({
        id: p.id,
        latitude: p.latitude,
        longitude: p.longitude,
        photoIds: [p.id],
        from: p.takenAt,
        to: p.takenAt,
        sumLat: p.latitude,
        sumLng: p.longitude,
      });
    }
  }
  return places.map(({ sumLat: _lat, sumLng: _lng, ...place }) => place);
};

export interface Region {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
}

/**
 * The map's opening frame: every place in view, with a margin so pins aren't
 * cut off at the edges, and never zoomed in tighter than a neighbourhood.
 */
export const regionAround = (places: { latitude: number; longitude: number }[]): Region | null => {
  if (places.length === 0) return null;
  const lats = places.map((p) => p.latitude);
  const lngs = places.map((p) => p.longitude);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const MIN_DELTA = 0.02;
  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    latitudeDelta: Math.max((maxLat - minLat) * 1.4, MIN_DELTA),
    longitudeDelta: Math.max((maxLng - minLng) * 1.4, MIN_DELTA),
  };
};

/** A link that opens this spot in the phone's own maps app (or the browser). */
export const mapsLink = (latitude: number, longitude: number) =>
  `https://www.google.com/maps/search/?api=1&query=${latitude.toFixed(6)},${longitude.toFixed(6)}`;

/**
 * What to search the map for: the place, plus the trip's destination when
 * the name doesn't already say where (so "Time Out Market" finds the one in
 * Lisbon, not the one in New York).
 */
export const placeQuery = (place: string, destination?: string | null) => {
  const name = place.trim();
  const city = destination?.split(',')[0]?.trim();
  if (!city || name.toLowerCase().includes(city.toLowerCase())) return name;
  return `${name}, ${destination!.trim()}`;
};

/** Links that open turn-by-turn directions with the destination already chosen. */
export const directionsLinks = (query: string) => ({
  google: `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(query)}`,
  apple: `https://maps.apple.com/?daddr=${encodeURIComponent(query)}`,
});
