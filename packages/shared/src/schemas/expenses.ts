import { z } from 'zod';
import { SPLIT_METHODS } from '../money';

export const EXPENSE_CATEGORIES = ['food', 'transport', 'stay', 'activity', 'shopping', 'other'] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export const SETTLEMENT_METHODS = ['cash', 'transfer', 'other'] as const;
export type SettlementMethod = (typeof SETTLEMENT_METHODS)[number];

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const currency = z.string().trim().length(3).toUpperCase();
const MAX_AMOUNT = 100_000_000_00;

export const ExpenseSplit = z.object({
  userId: z.string().uuid(),
  /** What was entered: ignored for equal, an amount for exact, basis points for percent, a count for shares. */
  value: z.number().int(),
  /** Their part, in the trip's currency. */
  shareMinor: z.number().int(),
});
export type ExpenseSplit = z.infer<typeof ExpenseSplit>;

export const Expense = z.object({
  id: z.string().uuid(),
  tripId: z.string().uuid(),
  paidBy: z.string().uuid(),
  description: z.string(),
  category: z.enum(EXPENSE_CATEGORIES),
  amountMinor: z.number().int(),
  currency: z.string().length(3),
  /** 1 unit of `currency` in the trip's currency, frozen when it was logged. */
  fxRate: z.number(),
  baseAmountMinor: z.number().int(),
  spentOn: isoDate,
  splitMethod: z.enum(SPLIT_METHODS),
  splits: z.array(ExpenseSplit),
  itemId: z.string().uuid().nullable(),
  bookingId: z.string().uuid().nullable(),
  sourceMessageId: z.string().uuid().nullable(),
  createdBy: z.string().uuid(),
  version: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Expense = z.infer<typeof Expense>;

const splitEntry = z.object({ userId: z.string().uuid(), value: z.number().int().min(0).default(0) });

const editableFields = {
  paidBy: z.string().uuid(),
  description: z.string().trim().min(1, 'Say what it was for').max(120),
  category: z.enum(EXPENSE_CATEGORIES),
  amountMinor: z.number().int().min(1, 'Enter an amount').max(MAX_AMOUNT),
  currency,
  /** Leave out to use today's rate; send one to match what your bank charged. */
  fxRate: z.number().positive().max(1_000_000).optional(),
  spentOn: isoDate,
  splitMethod: z.enum(SPLIT_METHODS),
  splits: z.array(splitEntry).min(1, 'Choose who this is shared by').max(50),
  itemId: z.string().uuid().nullable(),
  bookingId: z.string().uuid().nullable(),
  sourceMessageId: z.string().uuid().nullable(),
};

export const CreateExpenseInput = z.object({
  ...editableFields,
  id: z.string().uuid().optional(),
  category: editableFields.category.default('other'),
  splitMethod: editableFields.splitMethod.default('equal'),
  itemId: editableFields.itemId.optional(),
  bookingId: editableFields.bookingId.optional(),
  sourceMessageId: editableFields.sourceMessageId.optional(),
});
export type CreateExpenseInput = z.input<typeof CreateExpenseInput>;

/** `version` is the one you last saw; a mismatch means someone changed it since. */
export const UpdateExpenseInput = z
  .object(editableFields)
  .partial()
  .extend({ version: z.number().int().min(1) });
export type UpdateExpenseInput = z.input<typeof UpdateExpenseInput>;

export const Settlement = z.object({
  id: z.string().uuid(),
  tripId: z.string().uuid(),
  fromUser: z.string().uuid(),
  toUser: z.string().uuid(),
  /** In the trip's currency. */
  amountMinor: z.number().int(),
  method: z.enum(SETTLEMENT_METHODS),
  note: z.string().nullable(),
  settledAt: z.string(),
  createdBy: z.string().uuid(),
  version: z.number().int(),
});
export type Settlement = z.infer<typeof Settlement>;

export const CreateSettlementInput = z
  .object({
    id: z.string().uuid().optional(),
    fromUser: z.string().uuid(),
    toUser: z.string().uuid(),
    amountMinor: z.number().int().min(1, 'Enter an amount').max(MAX_AMOUNT),
    method: z.enum(SETTLEMENT_METHODS).default('cash'),
    note: z.string().trim().max(200).nullable().optional(),
  })
  .refine((s) => s.fromUser !== s.toUser, { message: 'Choose two different people', path: ['toUser'] });
export type CreateSettlementInput = z.input<typeof CreateSettlementInput>;

/** Anyone who appears in the money, including people who have since left the trip. */
export const MoneyPerson = z.object({
  userId: z.string().uuid(),
  displayName: z.string(),
  /** Still on the trip. Someone who left can still owe or be owed. */
  active: z.boolean(),
});
export type MoneyPerson = z.infer<typeof MoneyPerson>;

export const Balance = z.object({ userId: z.string().uuid(), netMinor: z.number().int() });
export const SuggestedTransfer = z.object({
  fromUser: z.string().uuid(),
  toUser: z.string().uuid(),
  amountMinor: z.number().int(),
});

/** Everything the Money tab shows, in one request. */
export const TripMoney = z.object({
  baseCurrency: z.string().length(3),
  expenses: z.array(Expense),
  settlements: z.array(Settlement),
  people: z.array(MoneyPerson),
  balances: z.array(Balance),
  suggested: z.array(SuggestedTransfer),
});
export type TripMoney = z.infer<typeof TripMoney>;

export const FxQuote = z.object({
  from: z.string().length(3),
  to: z.string().length(3),
  rate: z.number(),
  /** The day the rate is from (rates are published once a working day). */
  date: z.string(),
});
export type FxQuote = z.infer<typeof FxQuote>;
