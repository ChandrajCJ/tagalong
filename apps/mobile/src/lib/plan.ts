import type Feather from '@expo/vector-icons/Feather';
import type { ItemType, ItineraryItem } from '@tagalong/shared';
import { MONTH_NAMES, parseIso, toIso } from './dates';

/** Items that aren't on a specific day yet. */
export const ANYTIME = 'anytime';
export type DayKey = string; // an ISO date, or ANYTIME

const MAX_DAYS = 60;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const dayKeyOf = (item: Pick<ItineraryItem, 'date'>): DayKey => item.date ?? ANYTIME;
export const dateOfKey = (key: DayKey): string | null => (key === ANYTIME ? null : key);

/**
 * The days to show as pills: every day of the trip, plus any day an item
 * sits on outside those dates (for example after the trip's dates changed).
 */
export const planDays = (start: string | null, end: string | null, items: ItineraryItem[]): DayKey[] => {
  const days = new Set<string>();
  if (start) {
    const s = parseIso(start);
    const last = end ?? start;
    for (let i = 0; i < MAX_DAYS; i++) {
      const d = new Date(Date.UTC(s.year, s.month, s.day + i));
      const iso = toIso(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
      if (iso > last) break;
      days.add(iso);
    }
  }
  for (const item of items) if (item.date) days.add(item.date);
  return [...days].sort();
};

/** Plain byte order, matching how the server sorts positions. */
export const byPosition = (a: ItineraryItem, b: ItineraryItem) =>
  a.position < b.position ? -1 : a.position > b.position ? 1 : 0;

export const weekdayOf = (iso: string) => {
  const { year, month, day } = parseIso(iso);
  return WEEKDAYS[new Date(Date.UTC(year, month, day)).getUTCDay()]!;
};

export const dayOfMonth = (iso: string) => parseIso(iso).day;

/** "Thu, Jun 12". */
export const shortDate = (iso: string) => {
  const { month, day } = parseIso(iso);
  return `${weekdayOf(iso)}, ${MONTH_NAMES[month]!.slice(0, 3)} ${day}`;
};

/** "€25" or "€25.50", falling back to "25.00 EUR" where currency formatting isn't available. */
export const formatCost = (minor: number, currency: string) => {
  const amount = minor / 100;
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      minimumFractionDigits: minor % 100 === 0 ? 0 : 2,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
};

type IconName = React.ComponentProps<typeof Feather>['name'];

export const ITEM_TYPE_META: Record<ItemType, { label: string; icon: IconName }> = {
  activity: { label: 'Activity', icon: 'compass' },
  meal: { label: 'Meal', icon: 'coffee' },
  transport: { label: 'Transport', icon: 'navigation' },
  stay: { label: 'Stay', icon: 'home' },
  flight: { label: 'Flight', icon: 'send' },
  other: { label: 'Other', icon: 'star' },
};
