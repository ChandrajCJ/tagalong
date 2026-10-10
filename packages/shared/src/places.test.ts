import { describe, expect, it } from 'vitest';
import { inWindow, photoWindow } from './photo-window';
import { clusterPlaces, directionsLinks, mapsLink, metresBetween, placeQuery, regionAround } from './places';

const at = (id: string, latitude: number, longitude: number, takenAt: string | null = null) => ({
  id,
  latitude,
  longitude,
  takenAt,
});

// Real spots, so the distances mean something.
const PENA = { latitude: 38.7876, longitude: -9.3906 };
const MOORISH_CASTLE = { latitude: 38.7924, longitude: -9.3893 };
const BELEM = { latitude: 38.6916, longitude: -9.216 };

describe('metresBetween', () => {
  it('measures real distances', () => {
    // Pena Palace to the Moorish Castle is about half a kilometre on foot.
    expect(metresBetween(PENA, MOORISH_CASTLE)).toBeGreaterThan(500);
    expect(metresBetween(PENA, MOORISH_CASTLE)).toBeLessThan(600);
    // Sintra to Belém is 18.5 km in a straight line (checked independently).
    expect(metresBetween(PENA, BELEM) / 1000).toBeCloseTo(18.5, 1);
    expect(metresBetween(PENA, PENA)).toBe(0);
  });
});

describe('clusterPlaces', () => {
  it('puts photos taken a few steps apart on one pin', () => {
    const places = clusterPlaces([
      at('a', 38.7876, -9.3906, '2027-06-13T10:00:00'),
      at('b', 38.7877, -9.3905, '2027-06-13T10:05:00'),
      at('c', 38.7875, -9.3907, '2027-06-13T10:20:00'),
    ]);
    expect(places).toHaveLength(1);
    expect(places[0]).toMatchObject({
      id: 'a',
      photoIds: ['a', 'b', 'c'],
      from: '2027-06-13T10:00:00',
      to: '2027-06-13T10:20:00',
    });
    expect(places[0]!.latitude).toBeCloseTo(38.7876, 4);
  });

  it('keeps places that are genuinely apart on separate pins', () => {
    const places = clusterPlaces([
      at('pena', PENA.latitude, PENA.longitude, '2027-06-13T10:00:00'),
      at('castle', MOORISH_CASTLE.latitude, MOORISH_CASTLE.longitude, '2027-06-13T15:00:00'),
      at('belem', BELEM.latitude, BELEM.longitude, '2027-06-14T18:00:00'),
    ]);
    expect(places.map((p) => p.photoIds)).toEqual([['pena'], ['castle'], ['belem']]);
  });

  it('gives a place the same id whatever order the photos arrive in', () => {
    const photos = [
      at('first', 38.7876, -9.3906, '2027-06-13T10:00:00'),
      at('second', 38.7877, -9.3905, '2027-06-13T11:00:00'),
    ];
    expect(clusterPlaces(photos)[0]!.id).toBe('first');
    expect(clusterPlaces([...photos].reverse())[0]!.id).toBe('first');
  });

  it('returns nothing for no photos', () => {
    expect(clusterPlaces([])).toEqual([]);
  });
});

describe('regionAround', () => {
  it('frames every place with a margin', () => {
    const region = regionAround([PENA, BELEM])!;
    expect(region.latitude).toBeCloseTo((PENA.latitude + BELEM.latitude) / 2, 6);
    expect(region.latitudeDelta).toBeGreaterThan(PENA.latitude - BELEM.latitude);
    expect(region.longitudeDelta).toBeGreaterThan(BELEM.longitude - PENA.longitude);
  });

  it("doesn't zoom in to a single rooftop when there's only one place", () => {
    const region = regionAround([PENA])!;
    expect(region.latitudeDelta).toBe(0.02);
    expect(region.longitudeDelta).toBe(0.02);
  });

  it('has nothing to frame without places', () => {
    expect(regionAround([])).toBeNull();
  });
});

describe('mapsLink', () => {
  it('opens the spot in a maps app', () => {
    expect(mapsLink(38.78761234, -9.39061234)).toBe(
      'https://www.google.com/maps/search/?api=1&query=38.787612,-9.390612',
    );
  });
});

describe('photoWindow', () => {
  it('spans a plan item from its start to the end of its last minute', () => {
    expect(photoWindow({ date: '2027-06-13', startTime: '10:00', endTime: '13:30' })).toEqual({
      from: '2027-06-13T10:00:00',
      to: '2027-06-13T13:30:59',
    });
  });

  it('assumes three hours when there is no end time', () => {
    expect(photoWindow({ date: '2027-06-13', startTime: '10:00', endTime: null })).toEqual({
      from: '2027-06-13T10:00:00',
      to: '2027-06-13T13:00:59',
    });
  });

  it('runs past midnight when the end is before the start', () => {
    expect(photoWindow({ date: '2027-06-14', startTime: '22:00', endTime: '01:00' })).toEqual({
      from: '2027-06-14T22:00:00',
      to: '2027-06-15T01:00:59',
    });
  });

  it('rolls a three-hour default into the next day, and the next month', () => {
    expect(photoWindow({ date: '2027-06-30', startTime: '23:00', endTime: null })?.to).toBe(
      '2027-07-01T02:00:59',
    );
  });

  it('claims no photos for an all-day item or one with no date', () => {
    expect(photoWindow({ date: '2027-06-13', startTime: null, endTime: null })).toBeNull();
    expect(photoWindow({ date: null, startTime: '10:00', endTime: '11:00' })).toBeNull();
  });
});

describe('inWindow', () => {
  const sintra = photoWindow({ date: '2027-06-13', startTime: '10:00', endTime: '13:30' });

  it('includes both ends', () => {
    expect(inWindow('2027-06-13T10:00:00', sintra)).toBe(true);
    expect(inWindow('2027-06-13T13:30:45', sintra)).toBe(true);
  });

  it('excludes just outside, and other days at the same time', () => {
    expect(inWindow('2027-06-13T09:59:59', sintra)).toBe(false);
    expect(inWindow('2027-06-13T13:31:00', sintra)).toBe(false);
    expect(inWindow('2027-06-14T11:00:00', sintra)).toBe(false);
  });

  it('treats a time without seconds as the start of that minute', () => {
    // As text, "10:00" sorts before "10:00:00"; it must still count.
    expect(inWindow('2027-06-13T10:00', sintra)).toBe(true);
  });

  it('never matches an undated photo', () => {
    expect(inWindow(null, sintra)).toBe(false);
  });
});

describe('directions', () => {
  it('adds the destination when the place name doesn’t say where', () => {
    expect(placeQuery('Time Out Market', 'Lisbon, Portugal')).toBe('Time Out Market, Lisbon, Portugal');
    expect(placeQuery('Belém Tower, Lisbon', 'Lisbon, Portugal')).toBe('Belém Tower, Lisbon');
    expect(placeQuery('  Pena Palace ', null)).toBe('Pena Palace');
  });

  it('opens Google Maps and Apple Maps with the destination filled in', () => {
    expect(directionsLinks('Time Out Market, Lisbon')).toEqual({
      google: 'https://www.google.com/maps/dir/?api=1&destination=Time%20Out%20Market%2C%20Lisbon',
      apple: 'https://maps.apple.com/?daddr=Time%20Out%20Market%2C%20Lisbon',
    });
  });
});
