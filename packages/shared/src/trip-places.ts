/**
 * Trips with several places (Lisbon → Porto → Madrid): which place a day
 * belongs to, the one-line summary older phones still read, and the rules
 * for each place's dates. Pure, so they're tested here.
 */
import { metresBetween } from './places';
import type { Bounds } from './schemas/places';

export interface DatedPlace {
  startDate: string | null;
  endDate: string | null;
}

/** "Lisbon" from "Lisbon, Portugal". */
export const cityOf = (destination: string) => destination.split(',')[0]?.trim() || destination.trim();

export interface DayPlace<P> {
  /** Where the day is spent: on a travel day, where you arrive. */
  place: P;
  /** On a travel day (one place ends the day the next begins), where you leave from. */
  leaving: P | null;
}

const lastDay = (p: DatedPlace) => p.endDate ?? p.startDate!;

/**
 * Which place a day belongs to: the one whose dates contain it, otherwise
 * the nearest one before it (a gap between Porto and Madrid is still Porto),
 * otherwise the first. Places are in trip order. A day one place ends and
 * another begins belongs to both. A null date ("no day yet") is the first place's.
 */
export const placeForDate = <P extends DatedPlace>(places: P[], date: string | null): DayPlace<P> | null => {
  if (places.length === 0) return null;
  const first = { place: places[0]!, leaving: null };
  if (!date) return first;
  const dated = places.filter((p) => p.startDate);
  // Stable sort: same start day keeps trip order.
  const containing = dated
    .filter((p) => p.startDate! <= date && date <= lastDay(p))
    .sort((a, b) => (a.startDate! < b.startDate! ? -1 : a.startDate! > b.startDate! ? 1 : 0));
  if (containing.length > 1) {
    const [leaving, place] = containing.slice(-2) as [P, P];
    return { place, leaving };
  }
  if (containing.length === 1) return { place: containing[0]!, leaving: null };
  let before: P | null = null;
  for (const p of dated) if (lastDay(p) < date && (!before || lastDay(p) >= lastDay(before))) before = p;
  return before ? { place: before, leaving: null } : first;
};

/** "Porto", or "Lisbon → Porto" on a travel day. */
export const dayPlaceLabel = <P extends { destination: string }>(day: DayPlace<P>) =>
  day.leaving ? `${cityOf(day.leaving.destination)} → ${cityOf(day.place.destination)}` : cityOf(day.place.destination);

/** What the trip itself keeps about where it is: the summary of its places. */
export interface PlaceColumns {
  destination: string;
  placeId: string | null;
  latitude: number | null;
  longitude: number | null;
  bounds: Bounds | null;
  countryCode: string | null;
  timezone: string | null;
}

/**
 * The trip's own destination fields, kept for older phones and every query
 * that reads them: "Lisbon → Porto → Madrid", the first place's spot, time
 * zone and country, and an area that covers them all.
 */
export const tripSummary = (places: PlaceColumns[]): PlaceColumns => {
  const first = places[0]!;
  if (places.length === 1) {
    // Only these fields: callers pass whole place rows, whose ids and dates aren't the trip's.
    const { destination, placeId, latitude, longitude, bounds, countryCode, timezone } = first;
    return { destination, placeId, latitude, longitude, bounds, countryCode, timezone };
  }
  const located = places.filter((p) => p.latitude !== null && p.longitude !== null);
  const lead = located[0] ?? first;
  const boxes = located.map((p): Bounds => p.bounds ?? [p.longitude!, p.latitude!, p.longitude!, p.latitude!]);
  const bounds: Bounds | null =
    boxes.length > 0
      ? [
          Math.min(...boxes.map((b) => b[0])),
          Math.min(...boxes.map((b) => b[1])),
          Math.max(...boxes.map((b) => b[2])),
          Math.max(...boxes.map((b) => b[3])),
        ]
      : null;
  return {
    destination: places.map((p) => cityOf(p.destination)).join(' → '),
    placeId: lead.placeId,
    latitude: lead.latitude,
    longitude: lead.longitude,
    bounds,
    countryCode: lead.countryCode ?? first.countryCode,
    timezone: first.timezone ?? lead.timezone,
  };
};

/**
 * What's wrong with the places' dates, in words, or null when they're fine.
 * Each must sit inside the trip's dates, and two places may share only a
 * travel day: the day one ends and the next begins.
 */
export const placeDatesProblem = (
  places: (DatedPlace & { destination: string })[],
  trip: DatedPlace,
): string | null => {
  const dated = places.filter((p) => p.startDate || p.endDate);
  for (const p of dated) {
    const city = cityOf(p.destination);
    if (!p.startDate) return `Add the day you arrive in ${city}, or clear its dates.`;
    if (p.endDate && p.endDate < p.startDate) return `${city}: leaving must be on or after arriving.`;
    if (!trip.startDate) return 'Set the trip’s dates before giving each place its own.';
    if (p.startDate < trip.startDate || lastDay(p) > (trip.endDate ?? trip.startDate)) {
      return `${city}’s dates need to be within the trip’s dates.`;
    }
  }
  for (let i = 0; i < dated.length; i++) {
    for (let j = i + 1; j < dated.length; j++) {
      const a = dated[i]!;
      const b = dated[j]!;
      const overlap = a.startDate! <= lastDay(b) && b.startDate! <= lastDay(a);
      const travelDay = lastDay(a) === b.startDate || lastDay(b) === a.startDate;
      if (overlap && !travelDay) {
        return `${cityOf(a.destination)} and ${cityOf(b.destination)} overlap. Places can share only the travel day, when one ends and the next begins.`;
      }
    }
  }
  return null;
};

const addDay = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

/**
 * The stretches of `from`..`to` spent in each place, in order, so each can
 * get its own weather. A travel day counts for where you arrive.
 */
export const placeSegments = <P extends DatedPlace>(places: P[], from: string, to: string) => {
  const segments: { place: P; from: string; to: string }[] = [];
  for (let day = from; day <= to; day = addDay(day)) {
    const place = placeForDate(places, day)?.place;
    if (!place) break;
    const last = segments.at(-1);
    if (last && last.place === place) last.to = day;
    else segments.push({ place, from: day, to: day });
  }
  return segments;
};

/**
 * The clock a stop's time is on: its day's place. On a travel day, a stop
 * that's on the map uses whichever of the two places is nearer; otherwise
 * the place you arrive at.
 */
export const timezoneForStop = (
  places: (DatedPlace & { timezone: string | null; location: { latitude: number; longitude: number } | null })[],
  date: string | null,
  at?: { latitude: number | null; longitude: number | null } | null,
): string | null => {
  const day = placeForDate(places, date);
  if (!day) return null;
  if (day.leaving && at?.latitude != null && at.longitude != null && day.leaving.location && day.place.location) {
    const spot = { latitude: at.latitude, longitude: at.longitude };
    const nearer = metresBetween(spot, day.leaving.location) < metresBetween(spot, day.place.location) ? day.leaving : day.place;
    return nearer.timezone ?? day.place.timezone;
  }
  return day.place.timezone;
};
