import { sameDayLastYear, weatherPlan } from './geo';
import type { TripWeather, WeatherDay } from './schemas/places';

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
            },
          ],
    ),
  };
};

/**
 * The weather to show for a trip: the forecast for the coming two weeks, or
 * last year's weather on the same dates for a trip further out.
 */
export const tripWeather = async (
  fetchImpl: Fetch,
  trip: { latitude: number | null; longitude: number | null; startDate: string | null; endDate: string | null },
  today: string,
  headers?: Record<string, string>,
): Promise<TripWeather> => {
  if (trip.latitude === null || trip.longitude === null) return { kind: 'none', timezone: null, days: [] };
  const plan = weatherPlan(trip.startDate, trip.endDate, today);
  if (!plan) return { kind: 'none', timezone: null, days: [] };
  const centre = { latitude: trip.latitude, longitude: trip.longitude };
  if (plan.kind === 'forecast') {
    const w = await openMeteoDaily(fetchImpl, centre, 'forecast', plan.from, plan.to, headers);
    return { kind: 'forecast', timezone: w.timezone, days: w.days };
  }
  // Last year's weather on the same dates, shown against this year's.
  const w = await openMeteoDaily(fetchImpl, centre, 'archive', sameDayLastYear(plan.from), sameDayLastYear(plan.to), headers);
  return { kind: 'typical', timezone: w.timezone, days: w.days.map((d) => ({ ...d, date: addYears(d.date, 1), rainChance: null })) };
};
