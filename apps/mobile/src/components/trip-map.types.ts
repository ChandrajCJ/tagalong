/** A pin on the trip map: a plan item (coloured by day) or an idea (outlined). */
export interface MapPin {
  id: string;
  latitude: number;
  longitude: number;
  color: string;
  /** A character or two inside the pin: the day number, or "?" for an idea. */
  label: string;
  /** Ideas are outlined, plan items filled. */
  outlined?: boolean;
  title: string;
}

/** What every version of the trip map takes: MapLibre in builds, react-native-maps in Expo Go, MapLibre GL on the web. */
export interface TripMapProps {
  pins: MapPin[];
  /** [west, south, east, north] to open on. */
  bounds: [number, number, number, number];
  selectedId?: string | null;
  onPressPin: (pin: MapPin) => void;
  /** A route to draw under the pins: [longitude, latitude] pairs, in one colour. */
  line?: MapLine | null;
}

export interface MapLine {
  coordinates: [number, number][];
  color: string;
}

/** Free, open map tiles and style (OpenFreeMap), no key needed. */
export const MAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';
