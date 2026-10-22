import { describe, expect, it } from 'vitest';
import {
  busiestMoment,
  dayHeader,
  dayNumberOf,
  journalPrompt,
  memoryFor,
  memoryLine,
  promptDay,
  recapDue,
  topPhotos,
  tripRecap,
  tripOver,
  type DayHeaderInput,
  type RecapInput,
} from './journal';

const id = (n: number) => `01900000-0000-7000-8000-${String(n).padStart(12, '0')}`;
const photo = (n: number, takenAt: string | null, favourites = 0, kind: 'photo' | 'video' = 'photo') => ({
  id: id(n),
  kind,
  favourites,
  takenAt,
});
const stop = (n: number, latitude: number | null, longitude: number | null) => ({
  id: id(100 + n),
  title: `Stop ${n}`,
  type: 'activity',
  startTime: null,
  placeName: null,
  latitude,
  longitude,
});

const header = (over: Partial<DayHeaderInput> = {}): DayHeaderInput => ({
  date: '2026-06-11',
  trip: { startDate: '2026-06-10', endDate: '2026-06-14', currency: 'EUR', headcount: 3 },
  city: 'Porto',
  centre: { latitude: 41.15, longitude: -8.61 },
  stops: [],
  photos: [],
  messages: [],
  expenses: [],
  ideas: [],
  ...over,
});

describe('day header', () => {
  it('numbers the trip’s days, and not the ones outside it', () => {
    expect(dayNumberOf('2026-06-10', '2026-06-14', '2026-06-10')).toBe(1);
    expect(dayNumberOf('2026-06-10', '2026-06-14', '2026-06-12')).toBe(3);
    expect(dayNumberOf('2026-06-10', '2026-06-14', '2026-06-15')).toBeNull();
    expect(dayNumberOf(null, null, '2026-06-12')).toBeNull();
  });

  it('measures the stops in plan order, skipping those with no place', () => {
    // Two points about 1.1 km apart (0.01° of latitude), with an unplaced stop between them.
    const h = dayHeader(header({ stops: [stop(1, 41.15, -8.61), stop(2, null, null), stop(3, 41.16, -8.61)] }));
    expect(h.stops.map((s) => s.title)).toEqual(['Stop 1', 'Stop 2', 'Stop 3']);
    expect(h.distanceM).toBeGreaterThan(1100);
    expect(h.distanceM).toBeLessThan(1120);
    expect(dayHeader(header({ stops: [stop(1, 41.15, -8.61)] })).distanceM).toBeNull();
  });

  it('shows the day’s spending, and what it comes to each', () => {
    const h = dayHeader(header({ expenses: [{ baseAmountMinor: 4500 }, { baseAmountMinor: 1501 }] }));
    expect(h.spentMinor).toBe(6001);
    expect(h.spentPerPersonMinor).toBe(2000);
  });

  it('counts photos and videos, and picks the most loved first', () => {
    const h = dayHeader(
      header({
        photos: [
          photo(1, '2026-06-11T09:00:00'),
          photo(2, '2026-06-11T10:00:00', 3),
          photo(3, '2026-06-11T08:00:00', 0, 'video'),
          photo(4, '2026-06-11T11:00:00', 1),
          photo(5, '2026-06-11T12:00:00'),
        ],
      }),
    );
    expect(h.photoCount).toBe(4);
    expect(h.videoCount).toBe(1);
    expect(h.topPhotoIds).toEqual([id(2), id(4), id(3), id(1)]);
  });

  it('falls back to the first photos when nobody hearted any', () => {
    expect(topPhotos([photo(2, '2026-06-11T10:00:00'), photo(1, '2026-06-11T09:00:00')], 1).map((p) => p.id)).toEqual([id(1)]);
  });

  it('highlights the most-voted idea that happened that day', () => {
    const h = dayHeader(
      header({
        ideas: [
          { id: id(10), title: 'Port tasting', votes: 3, itemDate: '2026-06-11' },
          { id: id(11), title: 'Surfing', votes: 5, itemDate: '2026-06-12' },
          { id: id(12), title: 'Tram 28', votes: 1, itemDate: '2026-06-11' },
        ],
      }),
    );
    expect(h.topIdea).toEqual({ id: id(10), title: 'Port tasting', votes: 3 });
  });

  it('finds the busiest 10 minutes of chat', () => {
    const at = (n: number, time: string) => ({ id: id(n), createdAt: `2026-06-11T${time}:00.000Z` });
    const messages = [at(1, '09:00'), at(2, '12:00'), at(3, '12:04'), at(4, '12:09'), at(5, '12:30'), at(6, '20:00')];
    expect(busiestMoment(messages)).toEqual({ from: '2026-06-11T12:00:00.000Z', count: 3, messageId: id(2) });
    expect(busiestMoment(messages.slice(0, 2))).toBeNull();
  });
});

describe('evening prompts', () => {
  const trip = { startDate: '2026-06-10', endDate: '2026-06-14' };

  it('asks a different question each day', () => {
    expect(journalPrompt(1, 'Goa')).toBe('Day 1 in Goa: what was the best moment?');
    expect(journalPrompt(2, 'Goa')).toBe('Best thing you ate today?');
    expect(journalPrompt(4, 'Goa')).toBe('Quote of the day?');
    expect(journalPrompt(5, null)).toBe('Day 5: what was the best moment?');
  });

  it('is due from the chosen time on the trip’s clock, during the trip only', () => {
    expect(promptDay({ date: '2026-06-11', time: '20:29' }, trip, '20:30')).toBeNull();
    expect(promptDay({ date: '2026-06-11', time: '20:35' }, trip, '20:30')).toBe('2026-06-11');
    expect(promptDay({ date: '2026-06-15', time: '21:00' }, trip, '20:30')).toBeNull();
    expect(promptDay({ date: '2026-06-09', time: '21:00' }, trip, '20:30')).toBeNull();
  });
});

describe('on this day', () => {
  it('matches a past year’s trip day, never this year’s', () => {
    const goa = { startDate: '2025-06-10', endDate: '2025-06-14' };
    expect(memoryFor(goa, '2026-06-12')).toEqual({ date: '2025-06-12', yearsAgo: 1 });
    expect(memoryFor(goa, '2026-06-20')).toBeNull();
    expect(memoryFor(goa, '2025-06-12')).toBeNull();
    expect(memoryFor({ startDate: '2023-06-12', endDate: null }, '2026-06-12')).toEqual({ date: '2023-06-12', yearsAgo: 3 });
    expect(memoryFor({ startDate: null, endDate: null }, '2026-06-12')).toBeNull();
  });

  it('says where you were', () => {
    expect(memoryLine(1, { stop: 'Dudhsagar Falls', city: 'Goa' })).toBe('A year ago today you were at Dudhsagar Falls');
    expect(memoryLine(2, { stop: null, city: 'Goa' })).toBe('2 years ago today you were in Goa');
  });
});

describe('recap timing', () => {
  it('is ready the morning after the trip, for a week', () => {
    expect(recapDue('2026-06-14', { date: '2026-06-14', time: '22:00' })).toBe(false);
    expect(recapDue('2026-06-14', { date: '2026-06-15', time: '08:59' })).toBe(false);
    expect(recapDue('2026-06-14', { date: '2026-06-15', time: '09:00' })).toBe(true);
    expect(recapDue('2026-06-14', { date: '2026-06-30', time: '10:00' })).toBe(false);
    expect(tripOver({ startDate: '2026-06-10', endDate: '2026-06-14' }, '2026-06-15')).toBe(true);
    expect(tripOver({ startDate: '2026-06-10', endDate: '2026-06-14' }, '2026-06-14')).toBe(false);
  });
});

describe('trip recap', () => {
  const ALEX = id(201);
  const SAM = id(202);
  const base: RecapInput = {
    trip: { startDate: '2026-06-10', endDate: '2026-06-12' },
    places: [
      { destination: 'Lisbon, Portugal', latitude: 38.72, longitude: -9.14, startDate: '2026-06-10', endDate: '2026-06-11' },
      { destination: 'Porto, Portugal', latitude: 41.15, longitude: -8.61, startDate: '2026-06-11', endDate: '2026-06-12' },
    ],
    items: [
      { date: '2026-06-10', title: 'Belém', latitude: 38.69, longitude: -9.2 },
      { date: '2026-06-10', title: 'Alfama', latitude: 38.71, longitude: -9.13 },
      { date: '2026-06-12', title: 'Ribeira', latitude: 41.14, longitude: -8.61 },
    ],
    photos: [photo(1, '2026-06-10T10:00:00', 2), photo(2, '2026-06-12T10:00:00'), photo(3, '2026-06-12T11:00:00', 0, 'video')],
    messages: [{ body: 'Pastéis! 😍😍' }, { body: 'On the train 🚆' }, { body: 'ok' }],
    reactions: [{ emoji: '😂' }, { emoji: '❤️' }],
    expenses: [
      { description: 'Dinner', baseAmountMinor: 6000, splits: [{ userId: ALEX, shareMinor: 3000 }, { userId: SAM, shareMinor: 3000 }] },
      { description: 'Train', baseAmountMinor: 9000, splits: [{ userId: ALEX, shareMinor: 6000 }, { userId: SAM, shareMinor: 3000 }] },
    ],
    entries: [
      { authorId: ALEX, date: '2026-06-10', body: 'Best custard tart of my life', mood: '😍', visibility: 'group' },
      { authorId: SAM, date: '2026-06-10', body: 'Secret: I was homesick', mood: null, visibility: 'private' },
    ],
  };

  it('adds up the whole trip', () => {
    const r = tripRecap(base);
    expect(r.stats).toMatchObject({ days: 3, places: 2, photos: 2, videos: 1, messages: 3, topEmoji: '😍' });
    // Lisbon to Porto alone is about 275 km.
    expect(r.stats.distanceM).toBeGreaterThan(270_000);
    expect(r.stats.spend).toEqual([
      { userId: ALEX, shareMinor: 9000 },
      { userId: SAM, shareMinor: 6000 },
    ]);
    expect(r.stats.biggestExpense).toEqual({ description: 'Train', amountMinor: 9000 });
    expect(r.stats.topPhotoIds[0]).toBe(id(1));
    expect(r.groupPhotoIds).toEqual([id(1), id(2)]);
  });

  it('tells it day by day, with each day’s city, and never a private entry', () => {
    const r = tripRecap(base);
    expect(r.days.map((d) => [d.dayNumber, d.city, d.route.length])).toEqual([
      [1, 'Lisbon', 2],
      [2, 'Lisbon → Porto', 0],
      [3, 'Porto', 1],
    ]);
    expect(r.days[0]!.snippets).toEqual([{ authorId: ALEX, body: 'Best custard tart of my life', mood: '😍' }]);
    expect(r.days[2]!.topPhotoIds).toEqual([id(2), id(3)]);
  });

  it('copes with a trip with no photos and no expenses', () => {
    const r = tripRecap({ ...base, photos: [], expenses: [], messages: [], reactions: [] });
    expect(r.stats).toMatchObject({ photos: 0, videos: 0, topEmoji: null, spend: [], biggestExpense: null });
    expect(r.groupPhotoIds).toEqual([]);
  });

  it('has no days for a trip without dates', () => {
    expect(tripRecap({ ...base, trip: { startDate: null, endDate: null } }).days).toEqual([]);
  });
});
