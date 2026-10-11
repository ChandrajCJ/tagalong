/**
 * Everything the app knows about a destination that doesn't need a server:
 * which currency a country uses, what a weather code means, and how places
 * from Wikipedia and OpenStreetMap are sorted into one list.
 */
import { metresBetween } from './places';

const EURO = ['AT', 'BE', 'CY', 'DE', 'EE', 'ES', 'FI', 'FR', 'GR', 'HR', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PT', 'SI', 'SK', 'AD', 'MC', 'SM', 'VA', 'ME', 'XK'];

const CURRENCY_BY_COUNTRY: Record<string, string> = {
  ...Object.fromEntries(EURO.map((c) => [c, 'EUR'])),
  AE: 'AED', AR: 'ARS', AU: 'AUD', BD: 'BDT', BG: 'BGN', BH: 'BHD', BR: 'BRL', BT: 'BTN', CA: 'CAD',
  CH: 'CHF', CL: 'CLP', CN: 'CNY', CO: 'COP', CR: 'CRC', CZ: 'CZK', DK: 'DKK', DO: 'DOP', EG: 'EGP',
  FJ: 'FJD', GB: 'GBP', GE: 'GEL', GH: 'GHS', HK: 'HKD', HU: 'HUF', ID: 'IDR', IL: 'ILS', IN: 'INR',
  IS: 'ISK', JM: 'JMD', JO: 'JOD', JP: 'JPY', KE: 'KES', KH: 'KHR', KR: 'KRW', KW: 'KWD', KZ: 'KZT',
  LA: 'LAK', LI: 'CHF', LK: 'LKR', MA: 'MAD', MM: 'MMK', MN: 'MNT', MO: 'MOP', MU: 'MUR', MV: 'MVR',
  MX: 'MXN', MY: 'MYR', NA: 'NAD', NG: 'NGN', NO: 'NOK', NP: 'NPR', NZ: 'NZD', OM: 'OMR', PE: 'PEN',
  PH: 'PHP', PK: 'PKR', PL: 'PLN', QA: 'QAR', RO: 'RON', RS: 'RSD', RU: 'RUB', RW: 'RWF', SA: 'SAR',
  SC: 'SCR', SE: 'SEK', SG: 'SGD', TH: 'THB', TN: 'TND', TR: 'TRY', TW: 'TWD', TZ: 'TZS', UA: 'UAH',
  UG: 'UGX', US: 'USD', UY: 'UYU', UZ: 'UZS', VN: 'VND', ZA: 'ZAR', ZM: 'ZMW', EC: 'USD', PA: 'USD',
  SV: 'USD', PR: 'USD', AL: 'ALL', AM: 'AMD', AZ: 'AZN', BA: 'BAM', BO: 'BOB', BY: 'BYN', CU: 'CUP',
  ET: 'ETB', GT: 'GTQ', HN: 'HNL', IQ: 'IQD', IR: 'IRR', MD: 'MDL', MK: 'MKD', MW: 'MWK', MZ: 'MZN',
  NI: 'NIO', PG: 'PGK', PY: 'PYG', SN: 'XOF', CI: 'XOF', CM: 'XAF', TT: 'TTD', ZW: 'ZWL', BS: 'BSD',
  BB: 'BBD', BZ: 'BZD', BW: 'BWP',
};

/** The currency a country uses ("IN" → "INR"), or null if we don't know it. */
export const currencyForCountry = (countryCode: string | null | undefined) =>
  countryCode ? (CURRENCY_BY_COUNTRY[countryCode.toUpperCase()] ?? null) : null;

/** What the WMO weather codes Open-Meteo returns mean, with an icon name the phone has. */
export const weatherInfo = (code: number): { label: string; icon: 'sun' | 'cloud' | 'cloud-drizzle' | 'cloud-rain' | 'cloud-snow' | 'cloud-lightning' | 'wind' } => {
  if (code === 0) return { label: 'Clear', icon: 'sun' };
  if (code <= 2) return { label: 'Partly cloudy', icon: 'sun' };
  if (code === 3) return { label: 'Cloudy', icon: 'cloud' };
  if (code === 45 || code === 48) return { label: 'Fog', icon: 'wind' };
  if (code >= 51 && code <= 57) return { label: 'Drizzle', icon: 'cloud-drizzle' };
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return { label: 'Rain', icon: 'cloud-rain' };
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return { label: 'Snow', icon: 'cloud-snow' };
  if (code >= 95) return { label: 'Thunderstorms', icon: 'cloud-lightning' };
  return { label: 'Mixed', icon: 'cloud' };
};

export const RECOMMENDATION_CATEGORIES = ['sights', 'food', 'nature', 'culture', 'nightlife', 'shopping'] as const;
type Category = (typeof RECOMMENDATION_CATEGORIES)[number];

/**
 * Wikipedia knows every geotagged article, including timelines, stations
 * and hospitals. Only articles whose short description sounds like
 * somewhere a visitor would go are kept, and sorted into categories.
 */
const WIKI_SKIP = /\b(station|metro|railway|airport|hospital|school|university|college|district|parish|municipality|neighbourhood|neighborhood|constituency|street|road|highway|bridge|company|club|stadium|office|building in|residential|village in|town in|city in|census|ward|disambiguation)\b/i;
const WIKI_CATEGORIES: [Category, RegExp][] = [
  ['nature', /\b(beach|park|garden|waterfall|falls|lake|mountain|peak|hill|island|bay|cave|reserve|sanctuary|mangrove|forest|river|lagoon|viewpoint|national park)\b/i],
  ['culture', /\b(museum|gallery|church|cathedral|basilica|temple|mosque|synagogue|monastery|convent|palace|fort|fortress|castle|monument|memorial|theatre|theater|opera|ruins|archaeological|heritage|cultural centre|cultural center|arts centre)\b/i],
  ['shopping', /\b(shopping mall|mall|bazaar|market)\b/i],
  ['sights', /\b(square|tower|landmark|statue|plaza|market|viewpoint|attraction|historic site|lighthouse|arch|fountain|aqueduct|zoo|aquarium)\b/i],
];

/** Which category a Wikipedia article belongs in, or null if it isn't a place to visit. */
export const classifyWikiPlace = (title: string, description: string | null): Category | null => {
  if (/^(timeline|list|history|geography|demographics|outline) of\b/i.test(title)) return null;
  const text = `${title} ${description ?? ''}`;
  if (!description) return null;
  if (WIKI_SKIP.test(description)) return null;
  for (const [category, pattern] of WIKI_CATEGORIES) if (pattern.test(text)) return category;
  return null;
};

export interface RankedPlace {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  /** Higher is better known: has a Wikipedia article, a photo, a website. */
  score: number;
}

const normalise = (name: string) =>
  name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(the|of|de|da|do|dos|das)\b/g, '')
    .trim();

/**
 * Joins places from several sources into one list: the same place named the
 * same way within 300 m counts once (keeping the better-known copy), then
 * the best known come first, nearest first among equals.
 */
export const mergePlaces = <T extends RankedPlace>(
  lists: T[][],
  centre: { latitude: number; longitude: number },
  limit = 40,
): (T & { distanceKm: number })[] => {
  const kept: T[] = [];
  for (const place of lists.flat().sort((a, b) => b.score - a.score)) {
    const key = normalise(place.name);
    if (!key) continue;
    const twin = kept.find(
      (k) =>
        normalise(k.name) === key &&
        metresBetween(k, place) < 300,
    );
    if (!twin) kept.push(place);
  }
  return kept
    .map((p) => ({ ...p, distanceKm: Math.round(metresBetween(centre, p) / 100) / 10 }))
    .sort((a, b) => b.score - a.score || a.distanceKm - b.distanceKm)
    .slice(0, limit);
};

/**
 * The days to show weather for, and whether a forecast reaches them. Forecasts
 * go 16 days ahead; a trip further out shows last year's weather on the same
 * dates instead, as "typical". With no dates, the coming week.
 */
export const weatherPlan = (
  start: string | null,
  end: string | null,
  today: string,
): { kind: 'forecast' | 'typical'; from: string; to: string } | null => {
  const addDays = (iso: string, n: number) => {
    const d = new Date(`${iso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  const lastForecastDay = addDays(today, 15);
  if (!start) return { kind: 'forecast', from: today, to: addDays(today, 6) };
  const tripEnd = end ?? start;
  if (tripEnd < today) return null; // The trip is over.
  // At most 16 days either way, which covers almost every trip.
  const cappedEnd = (from: string) => (tripEnd > addDays(from, 15) ? addDays(from, 15) : tripEnd);
  if (start <= lastForecastDay) {
    const from = start < today ? today : start;
    const to = cappedEnd(from) > lastForecastDay ? lastForecastDay : cappedEnd(from);
    return { kind: 'forecast', from, to };
  }
  return { kind: 'typical', from: start, to: cappedEnd(start) };
};

/** The same calendar day a year earlier, for "typical" weather. */
export const sameDayLastYear = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  const day = m === 2 && d === 29 ? 28 : d!;
  return `${y! - 1}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
};
