import { describe, expect, it } from 'vitest';
import { exifDate, exifDegrees, parseExif } from './exif';

describe('parseExif', () => {
  it('reads an iPhone photo, with its nested dictionaries and hemisphere letters', () => {
    const iphone = {
      '{Exif}': { DateTimeOriginal: '2026:06:12 18:30:05', PixelXDimension: 4032 },
      '{GPS}': { Latitude: 38.7139, LatitudeRef: 'N', Longitude: 9.1334, LongitudeRef: 'W' },
    };
    expect(parseExif(iphone)).toEqual({
      takenAt: '2026-06-12T18:30:05',
      latitude: 38.7139,
      longitude: -9.1334,
    });
  });

  it('reads an Android photo with flat keys and degree-minute-second strings', () => {
    const android = {
      DateTimeOriginal: '2026:06:13 09:15:00',
      // 38° 42' 50.04" S, 9° 8' 0.24" E
      GPSLatitude: '38/1,42/1,5004/100',
      GPSLatitudeRef: 'S',
      GPSLongitude: '9/1,8/1,24/100',
      GPSLongitudeRef: 'E',
    };
    const facts = parseExif(android);
    expect(facts.takenAt).toBe('2026-06-13T09:15:00');
    expect(facts.latitude).toBeCloseTo(-38.7139, 4);
    expect(facts.longitude).toBeCloseTo(9.133400, 4);
  });

  it('reads Android decimal coordinates that already carry their sign', () => {
    const facts = parseExif({ GPSLatitude: -33.8568, GPSLongitude: 151.2153 });
    expect(facts).toMatchObject({ latitude: -33.8568, longitude: 151.2153 });
  });

  it('falls back to the digitised time when the original is missing', () => {
    expect(parseExif({ DateTimeDigitized: '2026:06:14 07:00:00' }).takenAt).toBe('2026-06-14T07:00:00');
  });

  it('treats 0,0 as "no location", not a spot in the Atlantic', () => {
    const facts = parseExif({ GPSLatitude: 0, GPSLongitude: 0, DateTimeOriginal: '2026:06:12 10:00:00' });
    expect(facts).toEqual({ takenAt: '2026-06-12T10:00:00', latitude: null, longitude: null });
  });

  it('drops half a location rather than inventing the other half', () => {
    expect(parseExif({ GPSLatitude: 38.7 })).toMatchObject({ latitude: null, longitude: null });
  });

  it('returns nothing for the web, which has no EXIF at all', () => {
    expect(parseExif(null)).toEqual({ takenAt: null, latitude: null, longitude: null });
    expect(parseExif(undefined)).toEqual({ takenAt: null, latitude: null, longitude: null });
  });
});

describe('exifDate', () => {
  it('rejects the zeros a camera writes when its clock was never set', () => {
    expect(exifDate('0000:00:00 00:00:00')).toBeNull();
  });

  it('rejects impossible values and junk', () => {
    expect(exifDate('2026:13:40 25:61:00')).toBeNull();
    expect(exifDate('yesterday')).toBeNull();
    expect(exifDate(20260612)).toBeNull();
  });
});

describe('exifDegrees', () => {
  it('reads decimals, rational strings and arrays', () => {
    expect(exifDegrees(12.5)).toBe(12.5);
    expect(exifDegrees('12/1,30/1,0/1')).toBe(12.5);
    expect(exifDegrees([12, 30, 0])).toBe(12.5);
  });

  it('refuses a zero denominator rather than dividing by it', () => {
    expect(exifDegrees('12/1,30/0,0/1')).toBeNull();
  });
});
