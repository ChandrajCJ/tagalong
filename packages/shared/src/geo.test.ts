import { describe, expect, it } from 'vitest';
import { classifyWikiPlace, currencyForCountry, mergePlaces, sameDayLastYear, weatherInfo, weatherPlan } from './geo';

describe('currencyForCountry', () => {
  it('knows the currency of common destinations', () => {
    expect(currencyForCountry('IN')).toBe('INR');
    expect(currencyForCountry('pt')).toBe('EUR');
    expect(currencyForCountry('TH')).toBe('THB');
    expect(currencyForCountry('GB')).toBe('GBP');
  });
  it('says when it doesn’t know', () => {
    expect(currencyForCountry('ZZ')).toBeNull();
    expect(currencyForCountry(null)).toBeNull();
  });
});

describe('weatherInfo', () => {
  it('turns weather codes into words and icons', () => {
    expect(weatherInfo(0)).toEqual({ label: 'Clear', icon: 'sun' });
    expect(weatherInfo(63).icon).toBe('cloud-rain');
    expect(weatherInfo(81).label).toBe('Rain');
    expect(weatherInfo(95).label).toBe('Thunderstorms');
  });
});

describe('classifyWikiPlace', () => {
  it('keeps places worth visiting, by category', () => {
    expect(classifyWikiPlace('Baga Beach', 'Beach in Goa, India')).toBe('nature');
    expect(classifyWikiPlace('Basilica of Bom Jesus', 'Church in Goa, India')).toBe('culture');
    expect(classifyWikiPlace('Rossio', 'Town square in Lisbon, Portugal')).toBe('sights');
  });
  it('drops timelines, stations, hospitals and articles without a description', () => {
    expect(classifyWikiPlace('Timeline of Lisbon', null)).toBeNull();
    expect(classifyWikiPlace('Rossio Station', 'Metro station in Lisbon, Portugal')).toBeNull();
    expect(classifyWikiPlace('Hospital Real', 'Hospital in Lisbon, Portugal')).toBeNull();
    expect(classifyWikiPlace('Somewhere', null)).toBeNull();
  });
});

describe('mergePlaces', () => {
  const centre = { latitude: 15.5, longitude: 73.8 };
  it('counts the same place once, keeping the better-known copy', () => {
    const wiki = [{ id: 'wiki:1', name: 'Fort Aguada', latitude: 15.4925, longitude: 73.7732, score: 5 }];
    const osm = [
      { id: 'osm:way/2', name: 'Fort Aguada', latitude: 15.4927, longitude: 73.7735, score: 2 },
      { id: 'osm:node/3', name: 'Café Bodega', latitude: 15.5, longitude: 73.81, score: 1 },
    ];
    const merged = mergePlaces([wiki, osm], centre);
    expect(merged.map((p) => p.id)).toEqual(['wiki:1', 'osm:node/3']);
    expect(merged[0]!.distanceKm).toBeGreaterThan(2);
  });
  it('keeps two places with the same name when they’re far apart', () => {
    const a = { id: 'a', name: 'Church of St Anne', latitude: 15.5, longitude: 73.8, score: 1 };
    const b = { id: 'b', name: 'Church of St. Anne', latitude: 15.6, longitude: 73.9, score: 1 };
    expect(mergePlaces([[a, b]], centre)).toHaveLength(2);
  });
});

describe('weatherPlan', () => {
  const today = '2026-10-11';
  it('forecasts the coming week for a trip without dates', () => {
    expect(weatherPlan(null, null, today)).toEqual({ kind: 'forecast', from: '2026-10-11', to: '2026-10-17' });
  });
  it('forecasts a trip within the next two weeks, from today if it has started', () => {
    expect(weatherPlan('2026-10-15', '2026-10-18', today)).toEqual({ kind: 'forecast', from: '2026-10-15', to: '2026-10-18' });
    expect(weatherPlan('2026-10-09', '2026-10-13', today)).toEqual({ kind: 'forecast', from: '2026-10-11', to: '2026-10-13' });
  });
  it('shows typical weather for a trip further out, and nothing once it’s over', () => {
    expect(weatherPlan('2026-12-20', '2026-12-24', today)).toEqual({ kind: 'typical', from: '2026-12-20', to: '2026-12-24' });
    expect(weatherPlan('2026-09-01', '2026-09-05', today)).toBeNull();
  });
  it('finds the same day last year, even for 29 February', () => {
    expect(sameDayLastYear('2026-12-20')).toBe('2025-12-20');
    expect(sameDayLastYear('2028-02-29')).toBe('2027-02-28');
  });
});
