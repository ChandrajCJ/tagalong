import { describe, expect, it } from 'vitest';
import { defaultMode, estimateLeg, fixedStops, movableCount, optimiseDay, orderCost, type RouteStop } from './route';

/** A small random generator with a seed, so failures can be replayed. */
const seeded = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) % 2 ** 32;
  return seed / 2 ** 32;
};

const stop = (id: string, latitude: number | null = 0, longitude: number | null = 0, startTime: string | null = null): RouteStop => ({
  id,
  latitude,
  longitude,
  startTime,
});

/** Stops on a plane, with straight-line costs (one-way costs differ a little, like real roads). */
const randomDay = (rand: () => number, n: number, oneWay = false) => {
  const stops = Array.from({ length: n }, (_, i) => stop(`s${i}`, rand() * 10, rand() * 10));
  const matrix = stops.map((a, i) =>
    stops.map((b, j) => {
      const d = Math.hypot(a.latitude! - b.latitude!, a.longitude! - b.longitude!);
      return oneWay && i < j ? d * 1.2 : d;
    }),
  );
  return { stops, matrix };
};

const permutations = <T>(xs: T[]): T[][] =>
  xs.length <= 1 ? [xs] : xs.flatMap((x, i) => permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p]));

/**
 * The best order by trying every one that keeps the fixed stops in place and
 * each stretch between them to itself.
 */
const bruteForce = (stops: RouteStop[], matrix: number[][]) => {
  const fixed = fixedStops(stops);
  const stretches: number[][] = [[]];
  stops.forEach((_, i) => (fixed[i] ? stretches.push([]) : stretches.at(-1)!.push(i)));
  let orders: number[][] = [[]];
  for (const stretch of stretches) {
    const options = permutations(stretch);
    orders = orders.flatMap((o) => options.map((p) => [...o, ...p]));
  }
  let best = Infinity;
  for (const perm of orders) {
    let k = 0;
    const order = stops.map((_, i) => (fixed[i] ? i : perm[k++]!));
    best = Math.min(best, orderCost(order, stops, matrix));
  }
  return best;
};

describe('optimiseDay', () => {
  it('finds the best order on small random days', () => {
    const rand = seeded(7);
    for (let round = 0; round < 40; round++) {
      const { stops, matrix } = randomDay(rand, 3 + Math.floor(rand() * 5), round % 2 === 1);
      // Sometimes pin a stop to a time, so segments get split too.
      if (rand() < 0.4) stops[2]!.startTime = '13:00';
      const result = optimiseDay(stops, matrix);
      const ids = result.order.map((id) => stops.findIndex((s) => s.id === id));
      expect(orderCost(ids, stops, matrix)).toBeCloseTo(bruteForce(stops, matrix), 9);
      expect(result.after).toBeCloseTo(orderCost(ids, stops, matrix), 9);
      expect([...result.order].sort()).toEqual(stops.map((s) => s.id).sort());
    }
  });

  it('never moves the first stop, a timed stop or one without a location', () => {
    const stops = [
      stop('hotel', 0, 0),
      stop('far', 0, 9),
      stop('near', 0, 1),
      stop('lunch', 0, 5, '13:00'),
      stop('somewhere', null, null),
      stop('b', 0, 8),
      stop('a', 0, 6),
    ];
    const matrix = stops.map((a) => stops.map((b) => Math.abs((a.longitude ?? 0) - (b.longitude ?? 0))));
    const { order, after, before } = optimiseDay(stops, matrix);
    expect(order).toEqual(['hotel', 'near', 'far', 'lunch', 'somewhere', 'a', 'b']);
    expect(after).toBeLessThan(before);
  });

  it('keeps the order when it is already the shortest', () => {
    const stops = [stop('a', 0, 0), stop('b', 0, 1), stop('c', 0, 2)];
    const matrix = stops.map((a) => stops.map((b) => Math.abs(a.longitude! - b.longitude!)));
    expect(optimiseDay(stops, matrix)).toEqual({ order: ['a', 'b', 'c'], before: 2, after: 2 });
  });

  it('holds both ends of a stretch between two timed stops', () => {
    // Reordering freely would end at "x"; the 6 pm dinner has to stay last.
    const stops = [stop('start', 0, 0), stop('x', 0, 9), stop('y', 0, 1), stop('dinner', 0, 2, '18:00')];
    const matrix = stops.map((a) => stops.map((b) => Math.abs(a.longitude! - b.longitude!)));
    expect(optimiseDay(stops, matrix).order).toEqual(['start', 'y', 'x', 'dinner']);
  });

  it('handles a long day with the quick method, close to the true best', () => {
    const rand = seeded(42);
    // Points along a line, shuffled: the best order visits them left to right.
    const xs = Array.from({ length: 16 }, (_, i) => i);
    const shuffled = [0, ...xs.slice(1).sort(() => rand() - 0.5)];
    const stops = shuffled.map((x) => stop(`p${x}`, 0, x));
    const matrix = stops.map((a) => stops.map((b) => Math.abs(a.longitude! - b.longitude!)));
    const { order, after } = optimiseDay(stops, matrix);
    expect(order).toEqual(xs.map((x) => `p${x}`));
    expect(after).toBe(15);
  });

  it('keeps fixed stops at their index on random days, short and long', () => {
    const rand = seeded(2026);
    for (let round = 0; round < 60; round++) {
      // Up to 24 stops, so some stretches go past the exact limit to the quick method.
      const { stops, matrix } = randomDay(rand, 2 + Math.floor(rand() * 23), round % 3 === 0);
      stops.forEach((s, i) => {
        if (i === 0) return;
        const r = rand();
        if (r < 0.1) s.startTime = '12:00';
        else if (r < 0.18) [s.latitude, s.longitude] = [null, null];
      });
      const fixed = fixedStops(stops);
      const result = optimiseDay(stops, matrix);
      const ids = result.order.map((id) => stops.findIndex((s) => s.id === id));
      stops.forEach((s, i) => fixed[i] && expect(result.order[i]).toBe(s.id));
      expect([...result.order].sort()).toEqual(stops.map((s) => s.id).sort());
      // Never worse than now, and the reported cost is the real one.
      expect(result.after).toBeLessThanOrEqual(result.before + 1e-9);
      expect(result.before).toBeCloseTo(orderCost(stops.map((_, i) => i), stops, matrix), 9);
      expect(result.after).toBeCloseTo(orderCost(ids, stops, matrix), 9);
      // Exact whenever brute force is still cheap enough to check.
      if (stops.length <= 8) expect(result.after).toBeCloseTo(bruteForce(stops, matrix), 9);
    }
  });

  it('copes with nothing to move', () => {
    expect(optimiseDay([], [])).toEqual({ order: [], before: 0, after: 0 });
    expect(optimiseDay([stop('a')], [[0]]).order).toEqual(['a']);
  });
});

describe('fixedStops and movableCount', () => {
  it('counts the stops that could move', () => {
    const stops = [stop('a'), stop('b'), stop('c', 1, 1, '10:00'), stop('d', null, null), stop('e')];
    expect(fixedStops(stops)).toEqual([true, false, true, true, false]);
    expect(movableCount(stops)).toBe(2);
  });
});

describe('estimates', () => {
  const ROSSIO = { latitude: 38.7139, longitude: -9.1394 };
  const BELEM = { latitude: 38.6916, longitude: -9.216 };

  it('stretches the straight line for roads and uses a typical speed', () => {
    const walk = estimateLeg(ROSSIO, BELEM, 'foot');
    const drive = estimateLeg(ROSSIO, BELEM, 'car');
    // About 7 km in a straight line, so about 9 km by road.
    expect(walk.distanceM).toBeGreaterThan(8500);
    expect(walk.distanceM).toBeLessThan(9500);
    expect(walk.durationS / 60).toBeGreaterThan(100);
    expect(drive.durationS).toBeLessThan(walk.durationS / 4);
  });

  it('walks a compact day and drives a spread-out one', () => {
    expect(defaultMode([ROSSIO, { latitude: 38.7107, longitude: -9.1426 }])).toBe('foot');
    expect(defaultMode([ROSSIO, BELEM])).toBe('car');
    expect(defaultMode([])).toBe('foot');
  });
});
