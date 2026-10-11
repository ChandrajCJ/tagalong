import { classifyWikiPlace, type Bounds, type PlaceResult, type RecommendationCategory } from '@tagalong/shared';

/**
 * Open map data for destinations: OpenStreetMap search (Photon), places worth
 * visiting (Wikipedia and OpenStreetMap through Overpass), and weather
 * (Open-Meteo). All free and keyless. Swapped for a fake in tests, which must
 * never depend on the network.
 */
export interface Geo {
  search(query: string, near?: { latitude: number; longitude: number }): Promise<PlaceResult[]>;
  /** Geotagged Wikipedia articles near a point that sound like places to visit. */
  wikipediaNearby(centre: Point): Promise<GeoPlace[]>;
  /** Named OpenStreetMap places of a category in an area, or null if no server answered. */
  osmPlaces(bounds: Bounds, category: RecommendationCategory): Promise<GeoPlace[] | null>;
  weather(centre: Point, kind: 'forecast' | 'archive', from: string, to: string): Promise<GeoWeather>;
  timezoneAt(centre: Point): Promise<string | null>;
}

export interface Point {
  latitude: number;
  longitude: number;
}

export interface GeoPlace extends Point {
  id: string;
  name: string;
  category: RecommendationCategory;
  description: string | null;
  imageUrl: string | null;
  url: string | null;
  kind: string | null;
  /** How well known it is; better-known places come first. */
  score: number;
}

export interface GeoWeather {
  timezone: string | null;
  days: { date: string; code: number; maxC: number; minC: number; rainChance: number | null; rainMm: number | null }[];
}

export interface GeoConfig {
  userAgent: string;
  photonUrl: string;
  overpassUrls: string[];
  wikipediaApi: string;
}

const pretty = (value: string) => {
  const text = value.replace(/_/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
};

/** OpenStreetMap tags for each category, as Overpass filters. */
const OSM_FILTERS: Record<RecommendationCategory, string[]> = {
  sights: [
    'nwr["tourism"~"^(attraction|viewpoint|zoo|aquarium|theme_park)$"]["name"]',
    'nwr["historic"~"^(castle|fort|monument)$"]["name"]',
  ],
  food: ['nwr["amenity"~"^(restaurant|cafe|food_court|ice_cream)$"]["name"]'],
  nature: [
    'nwr["natural"~"^(beach|waterfall|peak|bay|cave_entrance|hot_spring)$"]["name"]',
    'nwr["leisure"~"^(park|nature_reserve|garden)$"]["name"]',
    'nwr["tourism"="viewpoint"]["name"]',
  ],
  culture: [
    'nwr["tourism"~"^(museum|gallery)$"]["name"]',
    'nwr["amenity"~"^(theatre|arts_centre)$"]["name"]',
    'nwr["historic"~"^(castle|fort|monument|memorial|archaeological_site|ruins)$"]["name"]',
    // Every chapel would swamp the list; only the ones with an article.
    'nwr["amenity"="place_of_worship"]["wikipedia"]["name"]',
  ],
  nightlife: ['nwr["amenity"~"^(bar|pub|nightclub|biergarten)$"]["name"]'],
  shopping: [
    'nwr["shop"~"^(mall|department_store|souvenir|gift|craft|art)$"]["name"]',
    'nwr["amenity"="marketplace"]["name"]',
  ],
};

const KIND_TAGS = ['tourism', 'amenity', 'natural', 'leisure', 'historic', 'shop'];

/** Turns an Overpass element into a place, judging how notable it is from its tags. */
const fromOsm = (
  el: { type: string; id: number; lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> },
  category: RecommendationCategory,
): GeoPlace | null => {
  const tags = el.tags ?? {};
  const lat = el.lat ?? el.center?.lat;
  const lon = el.lon ?? el.center?.lon;
  if (!tags.name || lat === undefined || lon === undefined) return null;
  const kindTag = KIND_TAGS.find((k) => tags[k]);
  const kind = kindTag ? pretty(tags[kindTag]!) : null;
  const wiki = tags.wikipedia?.match(/^en:(.+)$/)?.[1];
  const website = tags.website ?? tags['contact:website'];
  const image = tags.image?.startsWith('https://') ? tags.image : null;
  return {
    id: `osm:${el.type}/${el.id}`,
    name: tags['name:en'] ?? tags.name,
    category,
    description: tags.cuisine ? `${kind ?? 'Food'} · ${pretty(tags.cuisine.split(';')[0]!)}` : null,
    imageUrl: image,
    url: wiki ? `https://en.wikipedia.org/wiki/${encodeURIComponent(wiki)}` : website?.startsWith('http') ? website : null,
    kind,
    latitude: lat,
    longitude: lon,
    score: (tags.wikipedia || tags.wikidata ? 3 : 0) + (website ? 1 : 0) + (image ? 1 : 0) + (tags.opening_hours ? 0.5 : 0),
  };
};

export const openGeo = (config: GeoConfig): Geo => {
  const headers = { 'user-agent': config.userAgent, accept: 'application/json' };
  const getJson = async <T>(url: string, ms = 8000): Promise<T> => {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(ms) });
    if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}`);
    return (await res.json()) as T;
  };

  return {
    async search(query, near) {
      const params = new URLSearchParams({ q: query, limit: '8', lang: 'en' });
      // Cities, regions and countries only: a trip goes to a place, not a shop.
      for (const layer of ['city', 'district', 'locality', 'county', 'state', 'country']) params.append('layer', layer);
      if (near) {
        params.set('lat', String(near.latitude));
        params.set('lon', String(near.longitude));
      }
      type Feature = {
        geometry: { coordinates: [number, number] };
        properties: {
          name?: string;
          country?: string;
          countrycode?: string;
          state?: string;
          type?: string;
          osm_type?: string;
          osm_id?: number;
          extent?: [number, number, number, number];
        };
      };
      const body = await getJson<{ features: Feature[] }>(`${config.photonUrl}/api/?${params}`);
      const seen = new Set<string>();
      return body.features
        .filter((f) => f.properties.name)
        .map((f): PlaceResult => {
          const p = f.properties;
          const parts = [p.name!, p.type !== 'state' && p.state !== p.name ? p.state : undefined, p.type !== 'country' ? p.country : undefined];
          const [w, n, e, s] = p.extent ?? [];
          return {
            id: `osm:${p.osm_type ?? '?'}:${p.osm_id ?? 0}`,
            name: p.name!,
            label: [...new Set(parts.filter((x): x is string => !!x))].join(', '),
            kind: p.type ? pretty(p.type) : null,
            countryCode: p.countrycode?.toUpperCase() ?? null,
            longitude: f.geometry.coordinates[0],
            latitude: f.geometry.coordinates[1],
            bounds: p.extent ? [w!, s!, e!, n!] : null,
          };
        })
        // A city and its county often share a name; show the place once.
        .filter((r) => !seen.has(r.label) && seen.add(r.label) !== undefined);
    },

    async wikipediaNearby(centre) {
      const params = new URLSearchParams({
        action: 'query',
        format: 'json',
        generator: 'geosearch',
        ggscoord: `${centre.latitude}|${centre.longitude}`,
        ggsradius: '10000',
        ggslimit: '50',
        prop: 'coordinates|pageimages|description|extracts',
        exintro: '1',
        explaintext: '1',
        exsentences: '2',
        exlimit: '20',
        colimit: '50',
        piprop: 'thumbnail',
        pithumbsize: '480',
        pilimit: '50',
      });
      type Page = {
        pageid: number;
        title: string;
        description?: string;
        extract?: string;
        thumbnail?: { source: string };
        coordinates?: { lat: number; lon: number }[];
      };
      const body = await getJson<{ query?: { pages?: Record<string, Page> } }>(`${config.wikipediaApi}?${params}`);
      return Object.values(body.query?.pages ?? {}).flatMap((p): GeoPlace[] => {
        const at = p.coordinates?.[0];
        const category = classifyWikiPlace(p.title, p.description ?? null);
        if (!at || !category) return [];
        return [
          {
            id: `wiki:${p.pageid}`,
            name: p.title,
            category,
            description: p.extract?.trim() || p.description || null,
            imageUrl: p.thumbnail?.source ?? null,
            url: `https://en.wikipedia.org/?curid=${p.pageid}`,
            kind: p.description ? pretty(p.description.split(' in ')[0]!) : null,
            latitude: at.lat,
            longitude: at.lon,
            score: 4 + (p.thumbnail ? 1 : 0) + (p.extract && p.extract.length > 120 ? 1 : 0),
          },
        ];
      });
    },

    async osmPlaces([west, south, east, north], category) {
      const box = `(${south},${west},${north},${east})`;
      const query = `[out:json][timeout:20];(${OSM_FILTERS[category].map((f) => `${f}${box};`).join('')});out center tags 400;`;
      // The public servers are often busy; try each in turn before giving up.
      for (const url of config.overpassUrls) {
        try {
          const res = await fetch(url, {
            method: 'POST',
            headers: { ...headers, 'content-type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ data: query }),
            signal: AbortSignal.timeout(25_000),
          });
          if (!res.ok) continue;
          const body = (await res.json()) as { elements?: Parameters<typeof fromOsm>[0][] };
          return (body.elements ?? []).flatMap((el) => fromOsm(el, category) ?? []);
        } catch {
          // Busy or answered with an error page; next server.
        }
      }
      return null;
    },

    async weather(centre, kind, from, to) {
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
      type Daily = {
        time: string[];
        weather_code: (number | null)[];
        temperature_2m_max: (number | null)[];
        temperature_2m_min: (number | null)[];
        precipitation_probability_max?: (number | null)[];
        precipitation_sum?: (number | null)[];
      };
      const body = await getJson<{ timezone?: string; daily?: Daily }>(`${base}?${params}`);
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
    },

    async timezoneAt(centre) {
      const params = new URLSearchParams({
        latitude: String(centre.latitude),
        longitude: String(centre.longitude),
        timezone: 'auto',
        forecast_days: '1',
      });
      const body = await getJson<{ timezone?: string }>(`https://api.open-meteo.com/v1/forecast?${params}`).catch(() => null);
      return body?.timezone ?? null;
    },
  };
};
