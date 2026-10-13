import type { ListItem, ListItemScope, ListKind, TripList } from './schemas/lists';

/**
 * Checklists: who has ticked what, and the starter packing list. Pure
 * functions, shared by the API and the app.
 */

/** Done, as far as `userId` is concerned: the group's tick, or their own. */
export const isDoneFor = (item: Pick<ListItem, 'scope' | 'doneAt' | 'checkedBy'>, userId: string) =>
  item.scope === 'shared' ? item.doneAt !== null : item.checkedBy.includes(userId);

/**
 * "3 of 5 packed" for an "everyone" line. Only people still on the trip count,
 * on both sides: someone who left neither adds a tick nor is waited for.
 */
export const everyoneProgress = (item: Pick<ListItem, 'checkedBy'>, memberIds: string[]) => {
  const ticked = new Set(item.checkedBy);
  const waitingFor = memberIds.filter((id) => !ticked.has(id));
  return { checked: memberIds.length - waitingFor.length, total: memberIds.length, waitingFor };
};

/** The Overview's "Packing 12/30 · 2 to-dos left", from where `userId` stands. */
export const listsSummary = (lists: Pick<TripList, 'id' | 'kind'>[], items: ListItem[], userId: string) => {
  const kindOf = new Map(lists.map((l) => [l.id, l.kind]));
  const of = (kind: ListKind) => items.filter((i) => kindOf.get(i.listId) === kind);
  const packing = of('packing');
  const todos = of('todo');
  return {
    packed: packing.filter((i) => isDoneFor(i, userId)).length,
    packingTotal: packing.length,
    todosLeft: todos.filter((i) => !isDoneFor(i, userId)).length,
    todosTotal: todos.length,
  };
};

/** Open to-dos per plan item, for the ☑ badge on the plan. */
export const openTodosByItem = (lists: Pick<TripList, 'id' | 'kind'>[], items: ListItem[], userId: string) => {
  const todoLists = new Set(lists.filter((l) => l.kind === 'todo').map((l) => l.id));
  const counts = new Map<string, number>();
  for (const i of items) {
    if (!i.itemId || !todoLists.has(i.listId) || isDoneFor(i, userId)) continue;
    counts.set(i.itemId, (counts.get(i.itemId) ?? 0) + 1);
  }
  return counts;
};

/** What the starter packing list looks at: the weather for the trip's days, and where you're going. */
export interface PackingContext {
  /** From the trip's weather (forecast or typical). */
  weather: { minC: number; maxC: number; code: number; rainChance: number | null; rainMm: number | null }[];
  /**
   * Words about the trip's places: recommendation kinds ("Beach"), and the
   * titles of ideas and plan items ("Hike to the waterfall").
   */
  places: string[];
}

export interface PackingSuggestion {
  text: string;
  scope: ListItemScope;
  /** Why it's suggested, shown under it: "Rain is likely on some days". */
  reason: string;
}

const ALWAYS: PackingSuggestion[] = [
  { text: 'Passport or ID', scope: 'everyone', reason: 'Everyone needs one' },
  { text: 'Phone charger', scope: 'everyone', reason: 'Everyone needs one' },
  { text: 'Toothbrush and toiletries', scope: 'everyone', reason: 'Everyone needs one' },
  { text: 'Any medicines you take', scope: 'everyone', reason: 'Easy to forget' },
  { text: 'First-aid kit', scope: 'shared', reason: 'One for the group is enough' },
  { text: 'Power bank', scope: 'shared', reason: 'One or two for the group' },
];

const isRainy = (d: PackingContext['weather'][number]) =>
  (d.rainChance ?? 0) >= 40 ||
  (d.rainMm ?? 0) >= 2 ||
  (d.code >= 51 && d.code <= 67) ||
  (d.code >= 80 && d.code <= 82) ||
  d.code >= 95;
const isSnowy = (d: PackingContext['weather'][number]) => (d.code >= 71 && d.code <= 77) || d.code === 85 || d.code === 86;

const PLACE_RULES: { match: RegExp; items: PackingSuggestion[] }[] = [
  {
    match: /\b(beach|beaches|coast|lagoon|island|swim|swimming|snorkel\w*|surf\w*|pool)\b/i,
    items: [
      { text: 'Swimwear', scope: 'everyone', reason: 'There are beaches nearby' },
      { text: 'Beach towel', scope: 'everyone', reason: 'There are beaches nearby' },
      { text: 'Flip-flops', scope: 'everyone', reason: 'There are beaches nearby' },
    ],
  },
  {
    match: /\b(hike|hiking|trek|trekking|trail|mountain|peak|hill|waterfall|falls|national park|forest)\b/i,
    items: [
      { text: 'Walking shoes', scope: 'everyone', reason: 'For hikes and trails' },
      { text: 'Small backpack', scope: 'everyone', reason: 'For hikes and trails' },
    ],
  },
  {
    match: /\b(temple|mosque|church|cathedral|basilica|monastery|gurudwara|shrine)\b/i,
    items: [{ text: 'Clothes that cover shoulders and knees', scope: 'everyone', reason: 'For visiting temples and churches' }],
  },
];

/**
 * A starter packing list, from simple rules (no AI): the basics, plus what the
 * weather and the places call for. Things already on the list are left out.
 */
export const suggestPacking = (context: PackingContext, existing: string[] = []): PackingSuggestion[] => {
  const out: PackingSuggestion[] = [...ALWAYS];
  const days = context.weather;

  if (days.some(isRainy)) {
    out.push(
      { text: 'Umbrella', scope: 'everyone', reason: 'Rain is likely on some days' },
      { text: 'Rain jacket', scope: 'everyone', reason: 'Rain is likely on some days' },
    );
  }
  if (days.length > 0) {
    const coldest = Math.min(...days.map((d) => d.minC));
    const hottest = Math.max(...days.map((d) => d.maxC));
    if (coldest < 10) out.push({ text: 'Warm layers', scope: 'everyone', reason: `Down to ${Math.round(coldest)} °C` });
    if (coldest < 0 || days.some(isSnowy)) {
      out.push({ text: 'Gloves and a warm hat', scope: 'everyone', reason: days.some(isSnowy) ? 'Snow is likely' : 'Below freezing' });
    }
    if (hottest >= 28) {
      out.push(
        { text: 'Sunscreen', scope: 'shared', reason: `Up to ${Math.round(hottest)} °C` },
        { text: 'Sunglasses', scope: 'everyone', reason: `Up to ${Math.round(hottest)} °C` },
        { text: 'Water bottle', scope: 'everyone', reason: `Up to ${Math.round(hottest)} °C` },
      );
    }
  }

  const words = context.places.join(' \n ');
  for (const rule of PLACE_RULES) if (rule.match.test(words)) out.push(...rule.items);

  const seen = new Set(existing.map((t) => t.trim().toLowerCase()));
  return out.filter((s) => {
    const key = s.text.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};
