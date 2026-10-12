/**
 * Travel between a day's stops, and the "Shortest order" suggestion. Pure
 * functions, so the solver is tested here rather than against a map server.
 */
import { metresBetween } from './places';

export const TRAVEL_MODES = ['foot', 'car', 'bike'] as const;
/** The same as the `TravelMode` schema's type, which is exported from schemas/routes. */
type TravelMode = (typeof TRAVEL_MODES)[number];

/** A plan item, as far as getting from one to the next goes. */
export interface RouteStop {
  id: string;
  latitude: number | null;
  longitude: number | null;
  startTime: string | null;
}

export const isLocated = (s: Pick<RouteStop, 'latitude' | 'longitude'>) => s.latitude !== null && s.longitude !== null;

/** Typical door-to-door speeds in a town, in metres per second, for when no router answers. */
const TYPICAL_SPEED: Record<TravelMode, number> = { foot: 4.8 / 3.6, bike: 14 / 3.6, car: 28 / 3.6 };
/** Roads and paths are never straight; this is about how much longer they are. */
const DETOUR = 1.3;

/** A rough leg: straight-line distance stretched for roads, at a typical speed. */
export const estimateLeg = (
  from: { latitude: number; longitude: number },
  to: { latitude: number; longitude: number },
  mode: TravelMode,
) => {
  const distanceM = Math.round(metresBetween(from, to) * DETOUR);
  return { distanceM, durationS: Math.round(distanceM / TYPICAL_SPEED[mode]) };
};

/** Walk when everything is within 3 km of everything else, otherwise drive. */
export const defaultMode = (points: { latitude: number; longitude: number }[]): TravelMode => {
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      if (metresBetween(points[i]!, points[j]!) >= 3000) return 'car';
    }
  }
  return 'foot';
};

/**
 * Stops that stay where they are when the order is shortened: the first one
 * (usually where the day starts), anything at a set time, and anything not
 * on the map (there's no knowing how far it is).
 */
export const fixedStops = (stops: RouteStop[]) => stops.map((s, i) => i === 0 || s.startTime !== null || !isLocated(s));

/** How many stops "Shortest order" could move. */
export const movableCount = (stops: RouteStop[]) => fixedStops(stops).filter((f) => !f).length;

/**
 * The cost of an order: the sum of each step between two located stops next
 * to each other. A stop without a location breaks the chain, as it does on
 * the Plan list. `matrix[i][j]` is the cost from stops[i] to stops[j].
 */
export const orderCost = (order: number[], stops: RouteStop[], matrix: number[][]) => {
  let total = 0;
  for (let k = 1; k < order.length; k++) {
    const a = order[k - 1]!;
    const b = order[k]!;
    if (isLocated(stops[a]!) && isLocated(stops[b]!)) total += matrix[a]![b]!;
  }
  return total;
};

/** Exact up to this many stops between two fixed ones (2^10 × 10 states). */
const EXACT_LIMIT = 10;

/**
 * The cheapest way through `middle`, starting after `start` and ending before
 * `end`. A missing end, or one without a location, costs nothing to reach.
 */
const solveSegment = (start: number | null, middle: number[], end: number | null, cost: (a: number, b: number) => number) => {
  if (middle.length <= 1) return middle;
  const from = (b: number) => (start === null ? 0 : cost(start, b));
  const to = (a: number) => (end === null ? 0 : cost(a, end));
  return middle.length <= EXACT_LIMIT ? heldKarp(middle, from, to, cost) : twoOpt(nearestNeighbour(middle, from, cost), from, to, cost);
};

/** Held–Karp: the best path through every subset, ending at each stop, built up one stop at a time. */
const heldKarp = (nodes: number[], from: (b: number) => number, to: (a: number) => number, cost: (a: number, b: number) => number) => {
  const n = nodes.length;
  const full = (1 << n) - 1;
  const best = new Float64Array((full + 1) * n).fill(Infinity);
  const prev = new Int8Array((full + 1) * n).fill(-1);
  for (let i = 0; i < n; i++) best[(1 << i) * n + i] = from(nodes[i]!);
  for (let set = 1; set <= full; set++) {
    for (let last = 0; last < n; last++) {
      const here = best[set * n + last]!;
      if (!(set & (1 << last)) || here === Infinity) continue;
      for (let next = 0; next < n; next++) {
        if (set & (1 << next)) continue;
        const grown = set | (1 << next);
        const value = here + cost(nodes[last]!, nodes[next]!);
        if (value < best[grown * n + next]!) {
          best[grown * n + next] = value;
          prev[grown * n + next] = last;
        }
      }
    }
  }
  let last = 0;
  for (let i = 1; i < n; i++) {
    if (best[full * n + i]! + to(nodes[i]!) < best[full * n + last]! + to(nodes[last]!)) last = i;
  }
  const path: number[] = [];
  for (let set = full, at = last; at !== -1; ) {
    path.push(nodes[at]!);
    const before = prev[set * n + at]!;
    set &= ~(1 << at);
    at = before;
  }
  return path.reverse();
};

const nearestNeighbour = (nodes: number[], from: (b: number) => number, cost: (a: number, b: number) => number) => {
  const left = new Set(nodes);
  const path: number[] = [];
  let step = from;
  while (left.size > 0) {
    let pick = -1;
    let pickCost = Infinity;
    for (const b of left) {
      const c = step(b);
      if (c < pickCost) [pick, pickCost] = [b, c];
    }
    path.push(pick);
    left.delete(pick);
    step = (b) => cost(pick, b);
  }
  return path;
};

/** Reverses stretches of the path while that makes it shorter. Works for one-way costs too. */
const twoOpt = (
  path: number[],
  from: (b: number) => number,
  to: (a: number) => number,
  cost: (a: number, b: number) => number,
) => {
  const length = (p: number[]) => {
    let total = from(p[0]!) + to(p.at(-1)!);
    for (let k = 1; k < p.length; k++) total += cost(p[k - 1]!, p[k]!);
    return total;
  };
  let best = path;
  let bestLength = length(best);
  for (let improved = true; improved; ) {
    improved = false;
    for (let i = 0; i < best.length - 1; i++) {
      for (let j = i + 1; j < best.length; j++) {
        const candidate = [...best.slice(0, i), ...best.slice(i, j + 1).reverse(), ...best.slice(j + 1)];
        const candidateLength = length(candidate);
        if (candidateLength < bestLength - 1e-9) {
          best = candidate;
          bestLength = candidateLength;
          improved = true;
        }
      }
    }
  }
  return best;
};

export interface OptimisedDay {
  /** Every stop's id, in the suggested order. */
  order: string[];
  /** The cost of the current order and of the suggested one, in the matrix's units. */
  before: number;
  after: number;
}

/**
 * The shortest order for a day's stops. Fixed stops (see `fixedStops`) keep
 * their places; the ones between two fixed stops are reordered with both
 * ends held, so "Breakfast at the hotel" and "Dinner at 8" never move.
 */
export const optimiseDay = (stops: RouteStop[], matrix: number[][]): OptimisedDay => {
  const fixed = fixedStops(stops);
  const located = (i: number | null) => (i !== null && isLocated(stops[i]!) ? i : null);
  const cost = (a: number, b: number) => matrix[a]![b]!;
  const order: number[] = [];
  let anchor: number | null = null;
  let middle: number[] = [];
  const flush = (end: number | null) => {
    order.push(...solveSegment(located(anchor), middle, located(end), cost));
    middle = [];
  };
  stops.forEach((_, i) => {
    if (!fixed[i]) return void middle.push(i);
    flush(i);
    order.push(i);
    anchor = i;
  });
  flush(null);

  const current = stops.map((_, i) => i);
  const before = orderCost(current, stops, matrix);
  const after = orderCost(order, stops, matrix);
  // Never suggest something worse, even by rounding.
  if (after >= before) return { order: stops.map((s) => s.id), before, after: before };
  return { order: order.map((i) => stops[i]!.id), before, after };
};
