import { z } from 'zod';
import { EXPENSE_CATEGORIES } from '../money';

/** "Group": one amount for the whole trip. "Each person": an amount per traveler. */
export const BUDGET_MODES = ['group', 'per_person'] as const;
export type BudgetMode = (typeof BUDGET_MODES)[number];

/** The budget's 80% and 100% marks, each announced in the chat once. */
export const BUDGET_THRESHOLDS = [80, 100] as const;

const MAX_AMOUNT = 100_000_000_00;
const limit = z.number().int().min(1, 'Enter an amount').max(MAX_AMOUNT);

/** Optional limits per category, in the trip's currency; a missing category has no limit. */
export const BudgetCategories = z.record(z.enum(EXPENSE_CATEGORIES), limit);
export type BudgetCategories = z.infer<typeof BudgetCategories>;

/**
 * A trip's budget. Entirely optional: most trips have none. In "each person"
 * mode every amount here (the total and the category limits) is per person.
 */
export const Budget = z.object({
  tripId: z.string().uuid(),
  mode: z.enum(BUDGET_MODES),
  /** null when only category limits are set. */
  totalMinor: z.number().int().nullable(),
  categories: BudgetCategories,
  version: z.number().int(),
  updatedBy: z.string().uuid().nullable(),
  updatedAt: z.string(),
});
export type Budget = z.infer<typeof Budget>;

/** PUT /trips/:id/budget. Leave out `version` to add one; send the one you saw to change it. */
export const SetBudgetInput = z
  .object({
    mode: z.enum(BUDGET_MODES).default('group'),
    totalMinor: limit.nullable().default(null),
    categories: BudgetCategories.default({}),
    version: z.number().int().min(1).optional(),
  })
  .refine((b) => b.totalMinor !== null || Object.keys(b.categories).length > 0, {
    message: 'Set a total, or a limit for at least one category',
    path: ['totalMinor'],
  });
export type SetBudgetInput = z.input<typeof SetBudgetInput>;

/** The "Budget (optional)" row on New trip: a total, for the group or each person. */
export const NewTripBudget = z.object({
  mode: z.enum(BUDGET_MODES).default('group'),
  totalMinor: limit,
});
export type NewTripBudget = z.input<typeof NewTripBudget>;

/**
 * The same row on Edit trip. A null total keeps any category limits; with
 * none left, or `budget: null`, the trip goes back to having no budget.
 */
export const EditTripBudget = z.object({
  mode: z.enum(BUDGET_MODES).default('group'),
  totalMinor: limit.nullable(),
});
export type EditTripBudget = z.input<typeof EditTripBudget>;

/**
 * A cost in the plan that hasn't been paid yet: a plan item's estimate (for
 * everyone) or a booking's price, in the trip's currency. It stops counting
 * as planned once an expense is linked to it.
 */
export const PlannedCost = z.object({
  /** The plan item, or the item a booking sits on. */
  itemId: z.string().uuid().nullable(),
  bookingId: z.string().uuid().nullable(),
  title: z.string(),
  category: z.enum(EXPENSE_CATEGORIES),
  amountMinor: z.number().int(),
});
export type PlannedCost = z.infer<typeof PlannedCost>;

/** GET /trips/:id/budget: just enough for the Overview's "Budget: ₹6,600 left". */
export const TripBudget = z.object({
  budget: Budget.nullable(),
  /** Everything spent so far, in the trip's currency. */
  spentMinor: z.number().int(),
  /** My share of it. */
  myShareMinor: z.number().int(),
});
export type TripBudget = z.infer<typeof TripBudget>;
