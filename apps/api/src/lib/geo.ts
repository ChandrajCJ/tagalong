import tzlookup from '@photostructure/tz-lookup';
import {
  classifyWikiPlace,
  openMeteoDaily,
  type Bounds,
  type PlaceResult,
  type PlaceScope,
  type RecommendationCategory,
} from '@tagalong/shared';
import { safeFetch } from './link-preview';

/**
 * Open map data for destinations: OpenStreetMap search (Photon), places worth
 * visiting (Wikipedia and OpenStreetMap through Overpass), and weather
 * (Open-Meteo). All free and keyless. Swapped for a fake in tests, which must
 * never depend on the network.
 */
export interface Geo {
  search(query: string, options?: SearchOptions): Promise<PlaceResult[]>;
  /** Geotagged Wikipedia articles near a point that sound like places to visit. */
  wikipediaNearby(centre: Point): Promise<GeoPlace[]>;
  /** Named OpenStreetMap places of a category in an area, or null if no server answered. */
  osmPlaces(bounds: Bounds, category: RecommendationCategory): Promise<GeoPlace[] | null>;
  weather(centre: Point, kind: 'forecast' | 'archive', from: string, to: string): Promise<GeoWeather>;
  timezoneAt(centre: Point): Promise<string | null>;
  /** The lead photo of the destination's Wikipedia article, with its credit, for a trip cover. */
  destinationPhoto(name: string): Promise<DestinationPhoto | null>;
  /** Downloads a picture from Wikipedia's image server, through the guarded fetch. */
  fetchImage(url: string): Promise<{ contentType: string; body: Buffer }>;
}

export interface DestinationPhoto {
  url: string;
  credit: string | null;
  pageUrl: string | null;
}

/** Plain text from the bits of HTML Wikimedia puts in its metadata. */
const stripTags = (html: string) =>
  html
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

export interface Point {
  latitude: number;
  longitude: number;
}

export interface SearchOptions {
  /** Prefer answers near here. */
  near?: Point;
  /** Towns and regions for a trip (the default), or any place for the plan. */
  scope?: PlaceScope;
  /** Only answers inside this area. */
  bbox?: Bounds;
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
    async search(query, { near, scope = 'destination', bbox } = {}) {
      const params = new URLSearchParams({ q: query, limit: '8', lang: 'en' });
      if (scope === 'destination') {
        // Cities, regions and countries only: a trip goes to a place, not a shop.
        for (const layer of ['city', 'district', 'locality', 'county', 'state', 'country']) params.append('layer', layer);
      }
      if (near) {
        params.set('lat', String(near.latitude));
        params.set('lon', String(near.longitude));
        if (scope === 'place') {
          // Nearby matters more than famous when looking for a café in town.
          params.set('zoom', '12');
          params.set('location_bias_scale', '0.1');
        }
      }
      if (bbox) params.set('bbox', bbox.join(','));
      type Feature = {
        geometry: { coordinates: [number, number] };
        properties: {
          name?: string;
          country?: string;
          countrycode?: string;
          state?: string;
          city?: string;
          district?: string;
          locality?: string;
          street?: string;
          housenumber?: string;
          type?: string;
          osm_type?: string;
          osm_id?: number;
          osm_value?: string;
          extent?: [number, number, number, number];
        };
      };
      const body = await getJson<{ features: Feature[] }>(`${config.photonUrl}/api/?${params}`);
      const seen = new Set<string>();
      return body.features
        .filter((f) => f.properties.name)
        .map((f): PlaceResult => {
          const p = f.properties;
          const [w, n, e, s] = p.extent ?? [];
          const unique = (parts: (string | undefined)[]) => [...new Set(parts.filter((x): x is string => !!x && x !== p.name))];
          if (scope === 'place') {
            // "Av. 24 de Julho, Cais do Sodré, Lisbon": enough to tell two branches apart.
            const street = p.street ? (p.housenumber ? `${p.street} ${p.housenumber}` : p.street) : undefined;
            const address = unique([street, p.district ?? p.locality, p.city]).join(', ') || null;
            return {
              id: `osm:${p.osm_type ?? '?'}:${p.osm_id ?? 0}`,
              name: p.name!,
              label: [p.name!, ...unique([p.city ?? p.state, p.country])].join(', '),
              kind: p.osm_value ? pretty(p.osm_value) : p.type ? pretty(p.type) : null,
              countryCode: p.countrycode?.toUpperCase() ?? null,
              longitude: f.geometry.coordinates[0],
              latitude: f.geometry.coordinates[1],
              bounds: null,
              address,
            };
          }
          const parts = [p.name!, p.type !== 'state' && p.state !== p.name ? p.state : undefined, p.type !== 'country' ? p.country : undefined];
          return {
            id: `osm:${p.osm_type ?? '?'}:${p.osm_id ?? 0}`,
            name: p.name!,
            label: [...new Set(parts.filter((x): x is string => !!x))].join(', '),
            kind: p.type ? pretty(p.type) : null,
            countryCode: p.countrycode?.toUpperCase() ?? null,
            longitude: f.geometry.coordinates[0],
            latitude: f.geometry.coordinates[1],
            bounds: p.extent ? [w!, s!, e!, n!] : null,
            address: null,
          };
        })
        // A city and its county often share a name; show the place once.
        .filter((r) => !seen.has(`${r.label}|${r.address}`) && seen.add(`${r.label}|${r.address}`) !== undefined);
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

    async destinationPhoto(name) {
      // "Lisbon, Portugal" → the article for Lisbon, and its lead image.
      const search = new URLSearchParams({
        action: 'query',
        format: 'json',
        generator: 'search',
        gsrsearch: name,
        gsrlimit: '1',
        prop: 'pageimages',
        piprop: 'name',
      });
      type Page = { pageid: number; title: string; pageimage?: string };
      const found = await getJson<{ query?: { pages?: Record<string, Page> } }>(`${config.wikipediaApi}?${search}`);
      const page = Object.values(found.query?.pages ?? {})[0];
      if (!page?.pageimage) return null;

      const info = new URLSearchParams({
        action: 'query',
        format: 'json',
        titles: `File:${page.pageimage}`,
        prop: 'imageinfo',
        iiprop: 'url|extmetadata',
        iiurlwidth: '1600',
      });
      type Meta = Record<string, { value?: string } | undefined>;
      type FilePage = { imageinfo?: { thumburl?: string; url?: string; extmetadata?: Meta }[] };
      const file = await getJson<{ query?: { pages?: Record<string, FilePage> } }>(`${config.wikipediaApi}?${info}`);
      const image = Object.values(file.query?.pages ?? {})[0]?.imageinfo?.[0];
      const url = image?.thumburl ?? image?.url;
      // Only pictures we can show: Wikipedia's image server, as a photo (not a map or a logo in SVG).
      if (!url || !/^https:\/\/upload\.wikimedia\.org\/.+\.(jpe?g|png|webp)$/i.test(url)) return null;
      const artist = image?.extmetadata?.Artist?.value ? stripTags(image.extmetadata.Artist.value) : null;
      const licence = image?.extmetadata?.LicenseShortName?.value ?? null;
      const credit = [artist, licence].filter(Boolean).join(', ').slice(0, 300) || null;
      return { url, credit: credit ? `Photo: ${credit}` : null, pageUrl: `https://en.wikipedia.org/?curid=${page.pageid}` };
    },

    async fetchImage(url) {
      if (!/^https:\/\/upload\.wikimedia\.org\//.test(url)) throw new Error('Only Wikipedia images');
      const { contentType, body } = await safeFetch(url, {
        accept: ['image/jpeg', 'image/png', 'image/webp'],
        maxBytes: 8 * 1024 * 1024,
        timeoutMs: 15_000,
      });
      return { contentType, body };
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
      return openMeteoDaily(fetch, centre, kind, from, to, headers);
    },

    async timezoneAt(centre) {
      // Worked out from a built-in map of time zones: no service to ask, so
      // nothing to be rate-limited by (Open-Meteo refuses shared server addresses).
      try {
        return tzlookup(centre.latitude, centre.longitude);
      } catch {
        return null;
      }
    },
  };
};
