import { cityOf, dayPlaceLabel, placeForDate, type Trip } from '@tagalong/shared';
import { formatDateRange } from './format';

/** The place a day belongs to (Lisbon → Porto on a travel day), or null for a trip without places. */
export const dayPlaceOf = (trip: Pick<Trip, 'places'>, date: string | null) => placeForDate(trip.places, date);

/** "Porto", or "Lisbon → Porto" on a travel day; null when the trip has just one place. */
export const dayCityLabel = (trip: Pick<Trip, 'places'>, date: string | null) => {
  if (trip.places.length < 2) return null;
  const day = dayPlaceOf(trip, date);
  return day ? dayPlaceLabel(day) : null;
};

/** The place to search for directions around on a day: its own city, not the whole trip's summary. */
export const destinationFor = (trip: Pick<Trip, 'places' | 'destination'>, date: string | null) =>
  dayPlaceOf(trip, date)?.place.destination ?? trip.destination;

/**
 * "Lisbon (Oct 22–24) → Porto (24–26) → Madrid (26–29)": the trip's places,
 * each with its days, leaving out a month already said.
 */
export const placesLine = (trip: Pick<Trip, 'places' | 'destination'>) => {
  if (trip.places.length < 2) return trip.destination;
  let month: string | null = null;
  return trip.places
    .map((p) => {
      const city = cityOf(p.destination);
      if (!p.startDate) return city;
      const range = formatDateRange(p.startDate, p.endDate);
      const sameMonth = month === p.startDate.slice(0, 7) && (p.endDate ?? p.startDate).slice(0, 7) === month;
      month = (p.endDate ?? p.startDate).slice(0, 7);
      // "Oct 24–26" → "24–26" once October has been said.
      return `${city} (${sameMonth ? range.replace(/^[A-Z][a-z]{2} /, '') : range})`;
    })
    .join(' → ');
};
