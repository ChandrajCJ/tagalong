/**
 * Budget math shared by the API and the phone. A budget is optional: with
 * none, `budgetSummary` returns null and nothing about budgets shows.
 */
import { EXPENSE_CATEGORIES, formatMoney, type ExpenseCategory } from './money';
import { BUDGET_THRESHOLDS, type BudgetCategories, type BudgetMode, type TripBudget } from './schemas/budget';

export interface BudgetLike {
  mode: BudgetMode;
  totalMinor: number | null;
  categories: BudgetCategories;
}

/** What the summary needs of an expense; amounts are in the trip's currency. */
export interface BudgetExpense {
  category: ExpenseCategory;
  baseAmountMinor: number;
  spentOn: string;
  itemId: string | null;
  bookingId: string | null;
  splits: { userId: string; shareMinor: number }[];
}

export interface BudgetPlanned {
  itemId: string | null;
  bookingId: string | null;
  category: ExpenseCategory;
  /** For the whole group, in the trip's currency. */
  amountMinor: number;
}

export interface CategorySummary {
  category: ExpenseCategory;
  limitMinor: number | null;
  spentMinor: number;
  plannedMinor: number;
}

/**
 * Where a budget stands. In "each person" mode the amounts are the viewer's
 * own (their share of each expense against the per-person budget).
 */
export interface BudgetSummary {
  mode: BudgetMode;
  /** The total budget, or null when only categories have limits. */
  limitMinor: number | null;
  spentMinor: number;
  /** Costs in the plan with no expense yet. */
  plannedMinor: number;
  /** What's left of the total; negative once over. */
  leftMinor: number | null;
  /** Trip days still to come, today included; null without dates. */
  daysLeft: number | null;
  /** About how much can go each day for the rest of the trip, after what's planned. */
  perDayMinor: number | null;
  /** How far over the total this pace ends up; only from day 2 of the trip, and only when over. */
  projectedOverMinor: number | null;
  /** Categories with a limit or any spending, in the usual order. */
  categories: CategorySummary[];
  /** The whole group's spending, also in "each person" mode. */
  groupSpentMinor: number;
}

/** A plan item or booking's type, as the closest expense category. */
export const categoryFor = (type: string): ExpenseCategory => {
  if (type === 'restaurant' || type === 'meal') return 'food';
  if (['flight', 'train', 'car', 'transport'].includes(type)) return 'transport';
  if (type === 'stay') return 'stay';
  if (type === 'ticket' || type === 'activity') return 'activity';
  return 'other';
};

/**
 * Planned costs not yet paid. An expense linked to a plan item covers it and
 * the bookings on it; one linked to a booking covers that booking.
 */
export const unlinkedPlanned = <P extends Pick<BudgetPlanned, 'itemId' | 'bookingId'>>(
  planned: P[],
  expenses: Pick<BudgetExpense, 'itemId' | 'bookingId'>[],
) => {
  const items = new Set(expenses.map((e) => e.itemId).filter(Boolean));
  const bookings = new Set(expenses.map((e) => e.bookingId).filter(Boolean));
  return planned.filter(
    (p) => !(p.itemId && items.has(p.itemId)) && !(p.bookingId && bookings.has(p.bookingId)),
  );
};

const dayNumber = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y!, m! - 1, d!) / 86_400_000;
};

/**
 * Everything the budget card shows. `today` is a YYYY-MM-DD local date and
 * `headcount` how many are on the trip, which shares out planned costs in
 * "each person" mode. Returns null when there's no budget.
 */
export const budgetSummary = (
  budget: BudgetLike | null,
  expenses: BudgetExpense[],
  planned: BudgetPlanned[],
  trip: { startDate: string | null; endDate: string | null; headcount: number },
  today: string,
  me: string,
): BudgetSummary | null => {
  if (!budget) return null;
  const perPerson = budget.mode === 'per_person';
  const amountOf = (e: BudgetExpense) =>
    perPerson ? (e.splits.find((s) => s.userId === me)?.shareMinor ?? 0) : e.baseAmountMinor;
  const plannedOf = (p: BudgetPlanned) =>
    perPerson ? Math.round(p.amountMinor / Math.max(1, trip.headcount)) : p.amountMinor;

  const spentBy = new Map<ExpenseCategory, number>();
  const plannedBy = new Map<ExpenseCategory, number>();
  let spent = 0;
  let groupSpent = 0;
  for (const e of expenses) {
    const amount = amountOf(e);
    spent += amount;
    groupSpent += e.baseAmountMinor;
    spentBy.set(e.category, (spentBy.get(e.category) ?? 0) + amount);
  }
  let plannedTotal = 0;
  for (const p of unlinkedPlanned(planned, expenses)) {
    const amount = plannedOf(p);
    plannedTotal += amount;
    plannedBy.set(p.category, (plannedBy.get(p.category) ?? 0) + amount);
  }

  const categories = EXPENSE_CATEGORIES.filter(
    (c) => budget.categories[c] !== undefined || spentBy.has(c) || plannedBy.has(c),
  ).map((category) => ({
    category,
    limitMinor: budget.categories[category] ?? null,
    spentMinor: spentBy.get(category) ?? 0,
    plannedMinor: plannedBy.get(category) ?? 0,
  }));

  const limit = budget.totalMinor;
  const left = limit === null ? null : limit - spent;

  // Days: the whole trip before it starts, the rest of it (today too) during, none after.
  const start = trip.startDate;
  const end = trip.endDate ?? trip.startDate;
  let daysLeft: number | null = null;
  let projectedOver: number | null = null;
  if (start && end) {
    const [s, e, t] = [dayNumber(start), dayNumber(end), dayNumber(today)];
    daysLeft = t > e ? 0 : t < s ? e - s + 1 : e - t + 1;
    // Pace needs at least one whole day of the trip behind it.
    const elapsed = t - s + 1;
    if (limit !== null && elapsed >= 2 && t <= e) {
      const onTrip = expenses
        .filter((x) => x.spentOn >= start && x.spentOn <= today)
        .reduce((sum, x) => sum + amountOf(x), 0);
      const projected = spent + (onTrip / elapsed) * (e - t);
      projectedOver = projected > limit ? Math.round(projected - limit) : null;
    }
  }
  const free = left === null ? null : left - plannedTotal;
  const perDay = free !== null && free > 0 && daysLeft ? Math.floor(free / daysLeft) : null;

  return {
    mode: budget.mode,
    limitMinor: limit,
    spentMinor: spent,
    plannedMinor: plannedTotal,
    leftMinor: left,
    daysLeft,
    perDayMinor: perDay,
    projectedOverMinor: projectedOver,
    categories,
    groupSpentMinor: groupSpent,
  };
};

/** The whole group's limit the chat alerts watch: the total, times everyone in "each person" mode. */
export const alertLimit = (budget: BudgetLike | null, headcount: number) =>
  budget?.totalMinor == null
    ? null
    : budget.mode === 'per_person'
      ? budget.totalMinor * Math.max(1, headcount)
      : budget.totalMinor;

/** The thresholds (80, 100) that this much spending has reached. */
export const reachedThresholds = (spentMinor: number, limitMinor: number) =>
  BUDGET_THRESHOLDS.filter((t) => spentMinor * 100 >= limitMinor * t);

/** "Budget: ₹6,600 left" for the Overview, or null without a budget total. */
export const budgetLine = (status: TripBudget | null, currency: string) => {
  const budget = status?.budget;
  if (!budget || budget.totalMinor === null) return null;
  const perPerson = budget.mode === 'per_person';
  const left = budget.totalMinor - (perPerson ? status.myShareMinor : status.spentMinor);
  const label = perPerson ? 'Your budget' : 'Budget';
  return left >= 0
    ? `${label}: ${formatMoney(left, currency)} left`
    : `${label}: ${formatMoney(-left, currency)} over`;
};
