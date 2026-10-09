/**
 * When and where a photo was taken, from the EXIF the phone hands over.
 *
 * Every platform shapes this differently. iOS nests it under "{Exif}" and
 * "{GPS}" with positive coordinates and an N/S/E/W letter; Android puts flat
 * "GPSLatitude" keys at the top, sometimes as a decimal, sometimes as
 * "38/1,42/1,5004/100" degree-minute-second rationals; the web gives nothing.
 * This reads all of them and returns nothing rather than something wrong.
 */

type Exif = Record<string, unknown>;

export interface PhotoFacts {
  /** "2026-06-12T18:30:00": the clock where it was taken, with no timezone. */
  takenAt: string | null;
  latitude: number | null;
  longitude: number | null;
}

const NOTHING: PhotoFacts = { takenAt: null, latitude: null, longitude: null };

/** Looks for a key at the top level, then in iOS's nested dictionaries. */
const find = (exif: Exif, keys: string[], nests: string[]): unknown => {
  for (const key of keys) if (exif[key] != null) return exif[key];
  for (const nest of nests) {
    const inner = exif[nest];
    if (inner && typeof inner === 'object') {
      for (const key of keys) {
        const value = (inner as Exif)[key];
        if (value != null) return value;
      }
    }
  }
  return undefined;
};

/** "2026:06:12 18:30:00" → "2026-06-12T18:30:00". Rejects the all-zeros a camera writes when its clock was never set. */
export const exifDate = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const m = /^(\d{4})[:-](\d{2})[:-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(value.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  if (y === '0000' || mo === '00' || d === '00') return null;
  if (Number(mo) > 12 || Number(d) > 31 || Number(h) > 23 || Number(mi) > 59 || Number(s) > 59) {
    return null;
  }
  return `${y}-${mo}-${d}T${h}:${mi}:${s}`;
};

/** "5004/100" → 50.04. */
const rational = (part: string) => {
  const [num, den] = part.split('/').map(Number);
  if (num === undefined || Number.isNaN(num)) return NaN;
  return den === undefined ? num : den === 0 ? NaN : num / den;
};

/** A decimal, a "d/1,m/1,s/100" string, or a [d, m, s] array → decimal degrees. */
export const exifDegrees = (value: unknown): number | null => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  let parts: number[] | null = null;
  if (Array.isArray(value)) parts = value.map(Number);
  else if (typeof value === 'string') {
    const pieces = value.split(/[,\s]+/).filter(Boolean);
    parts = pieces.length === 1 ? [Number(pieces[0])] : pieces.map(rational);
  }
  if (!parts || parts.length === 0 || parts.some((p) => !Number.isFinite(p))) return null;
  const [deg = 0, min = 0, sec = 0] = parts;
  return deg + min / 60 + sec / 3600;
};

/** Applies the hemisphere letter, unless the number already carries a sign. */
const signed = (degrees: number, ref: unknown, negative: 'S' | 'W') =>
  typeof ref === 'string' && ref.trim().toUpperCase().startsWith(negative)
    ? -Math.abs(degrees)
    : degrees;

export const parseExif = (exif: Exif | null | undefined): PhotoFacts => {
  if (!exif || typeof exif !== 'object') return NOTHING;

  const takenAt =
    exifDate(find(exif, ['DateTimeOriginal'], ['{Exif}'])) ??
    exifDate(find(exif, ['DateTimeDigitized'], ['{Exif}'])) ??
    exifDate(find(exif, ['DateTime'], ['{TIFF}']));

  const rawLat = exifDegrees(find(exif, ['GPSLatitude', 'Latitude'], ['{GPS}']));
  const rawLng = exifDegrees(find(exif, ['GPSLongitude', 'Longitude'], ['{GPS}']));
  let latitude: number | null = null;
  let longitude: number | null = null;
  if (rawLat !== null && rawLng !== null) {
    const lat = signed(rawLat, find(exif, ['GPSLatitudeRef', 'LatitudeRef'], ['{GPS}']), 'S');
    const lng = signed(rawLng, find(exif, ['GPSLongitudeRef', 'LongitudeRef'], ['{GPS}']), 'W');
    const inRange = Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
    // 0,0 is in the Atlantic off Africa: it means "no fix", not a real place.
    const nullIsland = Math.abs(lat) < 1e-6 && Math.abs(lng) < 1e-6;
    if (inRange && !nullIsland) {
      latitude = Math.round(lat * 1e6) / 1e6;
      longitude = Math.round(lng * 1e6) / 1e6;
    }
  }
  return { takenAt, latitude, longitude };
};
