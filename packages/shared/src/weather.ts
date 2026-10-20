import { sameDayLastYear, weatherPlan } from './geo';
import type { TripWeather, WeatherDay } from './schemas/places';
import { cityOf, placeSegments, type DatedPlace } from './trip-places';

type Fetch = (url: string, init?: { signal?: AbortSignal; headers?: Record<string, string> }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

interface Daily {
  time: string[];
  weather_code: (number | null)[];
  temperature_2m_max: (number | null)[];
  temperature_2m_min: (number | null)[];
  precipitation_probability_max?: (number | null)[];
  precipitation_sum?: (number | null)[];
}

const addYears = (iso: string, years: number) => `${Number(iso.slice(0, 4)) + years}${iso.slice(4)}`;

/**
 * Daily weather from Open-Meteo (free, no key): the forecast, or what it was
 * on past dates (`archive`). Shared so phones can ask it directly: its limit
 * is per address, and a free server's address is shared with strangers who
 * use it up.
 */
export const openMeteoDaily = async (
  fetchImpl: Fetch,
  centre: { latitude: number; longitude: number },
  kind: 'forecast' | 'archive',
  from: string,
  to: string,
  headers?: Record<string, string>,
): Promise<{ timezone: string | null; days: WeatherDay[] }> => {
  const archive = kind === 'archive';
  const params = new URLSearchParams({
    latitude: String(centre.latitude),
    longitude: String(centre.longitude),
    daily: archive
      ? 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum'
      : 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
    timezone: 'auto',
    start_date: from,
    end_date: to,
  });
  const base = archive ? 'https://archive-api.open-meteo.com/v1/archive' : 'https://api.open-meteo.com/v1/forecast';
  const response = await fetchImpl(`${base}?${params}`, { signal: AbortSignal.timeout(10_000), headers });
  if (!response.ok) throw new Error(`${new URL(base).host} answered ${response.status}`);
  const body = (await response.json()) as { timezone?: string; daily?: Daily };
  const d = body.daily;
  return {
    timezone: body.timezone ?? null,
    days: (d?.time ?? []).flatMap((date, i) =>
      d!.weather_code[i] == null || d!.temperature_2m_max[i] == null
        ? []
        : [
            {
              date,
              code: d!.weather_code[i]!,
              maxC: Math.round(d!.temperature_2m_max[i]!),
              minC: Math.round(d!.temperature_2m_min[i] ?? d!.temperature_2m_max[i]!),
              rainChance: d!.precipitation_probability_max?.[i] ?? null,
              rainMm: d!.precipitation_sum?.[i] ?? null,
              place: null,
            },
          ],
    ),
  };
};

/** One of a trip's places, as far as its weather goes. */
export interface WeatherPlace extends DatedPlace {
  destination: string;
  latitude: number | null;
  longitude: number | null;
}

export interface WeatherStretch {
  centre: { latitude: number; longitude: number };
  from: string;
  to: string;
  /** "Porto", when the trip has several places. */
  place: string | null;
}

/**
 * What weather to ask for: the forecast or last year's, and for which days
 * at which place. A trip with several places gets each stretch of days at
 * its own place; days at a place that isn't on the map are left out.
 */
export const weatherStretches = (
  trip: { latitude: number | null; longitude: number | null; startDate: string | null; endDate: string | null },
  places: WeatherPlace[],
  today: string,
): { kind: 'forecast' | 'typical'; stretches: WeatherStretch[] } | null => {
  const plan = weatherPlan(trip.startDate, trip.endDate, today);
  if (!plan) return null;
  if (places.length <= 1) {
    const only = places[0] ?? trip;
    if (only.latitude === null || only.longitude === null) return null;
    return { kind: plan.kind, stretches: [{ centre: { latitude: only.latitude, longitude: only.longitude }, from: plan.from, to: plan.to, place: null }] };
  }
  const stretches = placeSegments(places, plan.from, plan.to).flatMap(({ place, from, to }): WeatherStretch[] =>
    place.latitude === null || place.longitude === null
      ? []
      : [{ centre: { latitude: place.latitude, longitude: place.longitude }, from, to, place: cityOf(place.destination) }],
  );
  return stretches.length > 0 ? { kind: plan.kind, stretches } : null;
};

/** One stretch's days: the forecast, or last year's weather shown against this year's dates. */
export const stretchWeather = async (
  fetchImpl: Fetch,
  kind: 'forecast' | 'typical',
  s: WeatherStretch,
  headers?: Record<string, string>,
): Promise<{ timezone: string | null; days: WeatherDay[] }> => {
  if (kind === 'forecast') {
    const w = await openMeteoDaily(fetchImpl, s.centre, 'forecast', s.from, s.to, headers);
    return { timezone: w.timezone, days: w.days.map((d) => ({ ...d, place: s.place })) };
  }
  const w = await openMeteoDaily(fetchImpl, s.centre, 'archive', sameDayLastYear(s.from), sameDayLastYear(s.to), headers);
  return {
    timezone: w.timezone,
    days: w.days.map((d) => ({ ...d, date: addYears(d.date, 1), rainChance: null, place: s.place })),
  };
};

/**
 * The weather to show for a trip: the forecast for the coming two weeks, or
 * last year's weather on the same dates for a trip further out. Each day
 * uses that day's place.
 */
export const tripWeather = async (
  fetchImpl: Fetch,
  trip: { latitude: number | null; longitude: number | null; startDate: string | null; endDate: string | null },
  today: string,
  headers?: Record<string, string>,
  places: WeatherPlace[] = [],
): Promise<TripWeather> => {
  const wanted = weatherStretches(trip, places, today);
  if (!wanted) return { kind: 'none', timezone: null, days: [] };
  const answers = await Promise.all(wanted.stretches.map((s) => stretchWeather(fetchImpl, wanted.kind, s, headers)));
  return { kind: wanted.kind, timezone: answers[0]?.timezone ?? null, days: answers.flatMap((a) => a.days) };
};
