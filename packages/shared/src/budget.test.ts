import { describe, expect, it } from 'vitest';
import {
  alertLimit,
  budgetLine,
  budgetSummary,
  categoryFor,
  reachedThresholds,
  unlinkedPlanned,
  type BudgetExpense,
  type BudgetLike,
  type BudgetPlanned,
} from './budget';
import { convertMinor } from './money';

const ME = 'me';
const SAM = 'sam';
const ITEM = 'item-1';
const BOOKING = 'booking-1';

const expense = (over: Partial<BudgetExpense> = {}): BudgetExpense => ({
  category: 'food',
  baseAmountMinor: 1000,
  spentOn: '2026-06-10',
  itemId: null,
  bookingId: null,
  splits: [
    { userId: ME, shareMinor: 500 },
    { userId: SAM, shareMinor: 500 },
  ],
  ...over,
});

const group = (totalMinor: number | null, categories: BudgetLike['categories'] = {}): BudgetLike => ({
  mode: 'group',
  totalMinor,
  categories,
});

// A five-day trip, 10–14 June.
const trip = { startDate: '2026-06-10', endDate: '2026-06-14', headcount: 2 };

describe('budget summary', () => {
  it('is null for a trip with no budget, whatever was spent', () => {
    expect(budgetSummary(null, [expense()], [], trip, '2026-06-11', ME)).toBeNull();
  });

  it('counts foreign expenses at the rate frozen when they were logged', () => {
    // $50 at 0.9 → €45, stored on the expense; today's rate doesn't matter.
    const usd = expense({ baseAmountMinor: convertMinor(5000, 'USD', 'EUR', 0.9), category: 'transport' });
    const s = budgetSummary(group(20000), [expense(), usd], [], trip, '2026-06-01', ME)!;
    expect(s.spentMinor).toBe(1000 + 4500);
    expect(s.leftMinor).toBe(20000 - 5500);
    expect(s.categories.map((c) => [c.category, c.spentMinor])).toEqual([
      ['food', 1000],
      ['transport', 4500],
    ]);
  });

  it('shows planned costs until an expense is linked to them', () => {
    const planned: BudgetPlanned[] = [
      { itemId: ITEM, bookingId: null, category: 'activity', amountMinor: 3000 },
      { itemId: null, bookingId: BOOKING, category: 'stay', amountMinor: 8000 },
    ];
    const before = budgetSummary(group(50000), [], planned, trip, '2026-06-01', ME)!;
    expect(before.plannedMinor).toBe(11000);

    const paid = [expense({ bookingId: BOOKING, baseAmountMinor: 8000, category: 'stay' })];
    const after = budgetSummary(group(50000), paid, planned, trip, '2026-06-01', ME)!;
    expect(after.plannedMinor).toBe(3000);
    expect(after.spentMinor).toBe(8000);
    expect(after.categories.find((c) => c.category === 'stay')).toMatchObject({ spentMinor: 8000, plannedMinor: 0 });
  });

  it('treats an expense on a plan item as paying for the bookings on it too', () => {
    const planned = [{ itemId: ITEM, bookingId: BOOKING }];
    expect(unlinkedPlanned(planned, [{ itemId: ITEM, bookingId: null }])).toEqual([]);
    expect(unlinkedPlanned(planned, [{ itemId: null, bookingId: 'other' }])).toEqual(planned);
  });

  it('measures each person against their own share in per-person mode', () => {
    const budget: BudgetLike = { mode: 'per_person', totalMinor: 5000, categories: { food: 2000 } };
    const dinner = expense({ baseAmountMinor: 3000, splits: [{ userId: ME, shareMinor: 1000 }, { userId: SAM, shareMinor: 2000 }] });
    const planned: BudgetPlanned[] = [{ itemId: ITEM, bookingId: null, category: 'activity', amountMinor: 4000 }];
    const s = budgetSummary(budget, [dinner], planned, trip, '2026-06-01', ME)!;
    expect(s.spentMinor).toBe(1000);
    expect(s.groupSpentMinor).toBe(3000);
    expect(s.leftMinor).toBe(4000);
    // The plan's cost is shared by the two people on the trip.
    expect(s.plannedMinor).toBe(2000);
    expect(s.categories[0]).toEqual({ category: 'food', limitMinor: 2000, spentMinor: 1000, plannedMinor: 0 });
  });

  it('works with category limits and no total', () => {
    const s = budgetSummary(group(null, { food: 5000, shopping: 2000 }), [expense()], [], trip, '2026-06-12', ME)!;
    expect(s.limitMinor).toBeNull();
    expect(s.leftMinor).toBeNull();
    expect(s.perDayMinor).toBeNull();
    expect(s.projectedOverMinor).toBeNull();
    expect(s.categories.map((c) => [c.category, c.limitMinor, c.spentMinor])).toEqual([
      ['food', 5000, 1000],
      ['shopping', 2000, 0],
    ]);
  });

  it('spreads what’s left over the whole trip before it starts', () => {
    const s = budgetSummary(group(10000), [expense({ baseAmountMinor: 3000, spentOn: '2026-05-01' })], [], trip, '2026-06-01', ME)!;
    expect(s.daysLeft).toBe(5);
    expect(s.perDayMinor).toBe(1400);
    expect(s.projectedOverMinor).toBeNull();
  });

  it('keeps planned costs out of the daily allowance', () => {
    const planned: BudgetPlanned[] = [{ itemId: ITEM, bookingId: null, category: 'activity', amountMinor: 2000 }];
    const s = budgetSummary(group(10000), [], planned, trip, '2026-06-01', ME)!;
    expect(s.perDayMinor).toBe(1600);
  });

  it('gives no pace warning on day 1, however much was spent', () => {
    const s = budgetSummary(group(10000), [expense({ baseAmountMinor: 9000 })], [], trip, '2026-06-10', ME)!;
    expect(s.daysLeft).toBe(5);
    expect(s.projectedOverMinor).toBeNull();
  });

  it('warns from day 2 when the pace ends up over', () => {
    // €40 on each of the first two days, plus a €50 flight paid before the trip.
    const spent = [
      expense({ baseAmountMinor: 5000, spentOn: '2026-05-20', category: 'transport' }),
      expense({ baseAmountMinor: 4000, spentOn: '2026-06-10' }),
      expense({ baseAmountMinor: 4000, spentOn: '2026-06-11' }),
    ];
    const s = budgetSummary(group(20000), spent, [], trip, '2026-06-11', ME)!;
    expect(s.daysLeft).toBe(4);
    // 130 so far + 40 a day for the 3 days after today = 250: 50 over.
    expect(s.projectedOverMinor).toBe(5000);
    // On track: no warning.
    expect(budgetSummary(group(30000), spent, [], trip, '2026-06-11', ME)!.projectedOverMinor).toBeNull();
  });

  it('has no days left once the trip is over', () => {
    const s = budgetSummary(group(10000), [expense()], [], trip, '2026-06-20', ME)!;
    expect(s.daysLeft).toBe(0);
    expect(s.perDayMinor).toBeNull();
    expect(s.projectedOverMinor).toBeNull();
  });

  it('skips days and pace for a trip without dates', () => {
    const s = budgetSummary(group(10000), [expense()], [], { startDate: null, endDate: null, headcount: 2 }, '2026-06-11', ME)!;
    expect(s.daysLeft).toBeNull();
    expect(s.perDayMinor).toBeNull();
  });
});

describe('budget alerts', () => {
  it('watches the whole group’s limit', () => {
    expect(alertLimit(group(10000), 4)).toBe(10000);
    expect(alertLimit({ mode: 'per_person', totalMinor: 5000, categories: {} }, 3)).toBe(15000);
    expect(alertLimit(group(null, { food: 100 }), 3)).toBeNull();
    expect(alertLimit(null, 3)).toBeNull();
  });

  it('reaches 80% and then 100%', () => {
    expect(reachedThresholds(7999, 10000)).toEqual([]);
    expect(reachedThresholds(8000, 10000)).toEqual([80]);
    expect(reachedThresholds(12000, 10000)).toEqual([80, 100]);
  });
});

describe('overview line', () => {
  const status = (budget: BudgetLike | null, spentMinor: number, myShareMinor = 0) => ({
    budget: budget && { ...budget, tripId: 't', version: 1, updatedBy: null, updatedAt: '' },
    spentMinor,
    myShareMinor,
  });

  it('says nothing without a budget total', () => {
    expect(budgetLine(null, 'EUR')).toBeNull();
    expect(budgetLine(status(null, 5000), 'EUR')).toBeNull();
    expect(budgetLine(status(group(null, { food: 100 }), 50), 'EUR')).toBeNull();
  });

  it('says what’s left, or how far over', () => {
    expect(budgetLine(status(group(2500000), 1840000), 'INR')).toBe('Budget: ₹6,600 left');
    expect(budgetLine(status(group(10000), 12000), 'EUR')).toBe('Budget: €20 over');
    expect(budgetLine(status({ mode: 'per_person', totalMinor: 5000, categories: {} }, 9000, 3000), 'EUR')).toBe(
      'Your budget: €20 left',
    );
  });
});

describe('categories from the plan', () => {
  it('maps plan and booking types to expense categories', () => {
    expect(categoryFor('restaurant')).toBe('food');
    expect(categoryFor('flight')).toBe('transport');
    expect(categoryFor('stay')).toBe('stay');
    expect(categoryFor('ticket')).toBe('activity');
    expect(categoryFor('other')).toBe('other');
  });
});
