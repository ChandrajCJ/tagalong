import { and, eq, isNotNull, isNull, notInArray, sql } from 'drizzle-orm';
import {
  bookings,
  budgetAlerts,
  budgets,
  changeLog,
  expenses,
  items,
  tripMembers,
  trips,
  type Db,
  type Tx,
} from '@tagalong/db';
import {
  alertLimit,
  categoryFor,
  convertMinor,
  formatMoney,
  reachedThresholds,
  unlinkedPlanned,
  type Budget,
  type BudgetCategories,
  type BudgetMode,
  type PlannedCost,
} from '@tagalong/shared';
import type { Redis } from 'ioredis';
import { publishTripEvent } from '../../lib/events';
import type { Rates } from '../../lib/fx';
import { postSystemMessage } from '../chat/channel';

type BudgetRow = typeof budgets.$inferSelect;

export interface BudgetValues {
  mode: BudgetMode;
  totalMinor: number | null;
  categories: BudgetCategories;
}

export const toBudget = (r: BudgetRow): Budget => ({
  tripId: r.tripId,
  mode: r.mode as BudgetMode,
  totalMinor: r.totalMinor,
  categories: r.categories as BudgetCategories,
  version: r.version,
  updatedBy: r.updatedBy,
  updatedAt: r.updatedAt.toISOString(),
});

export const loadBudget = async (dbOrTx: Db | Tx, tripId: string) => {
  const [row] = await dbOrTx.select().from(budgets).where(eq(budgets.tripId, tripId));
  return row ?? null;
};

/** Everyone on the trip now: the "each person" in a per-person budget. */
export const headcountOf = async (dbOrTx: Db | Tx, tripId: string) => {
  const [row] = await dbOrTx
    .select({ n: sql<number>`count(*)::int` })
    .from(tripMembers)
    .where(and(eq(tripMembers.tripId, tripId), isNull(tripMembers.leftAt)));
  return row?.n ?? 0;
};

/** Everything spent on the trip, in its currency. */
export const spentOn = async (dbOrTx: Db | Tx, tripId: string) => {
  const [row] = await dbOrTx
    .select({ total: sql<string>`coalesce(sum(${expenses.baseAmountMinor}), 0)` })
    .from(expenses)
    .where(and(eq(expenses.tripId, tripId), isNull(expenses.deletedAt)));
  return Number(row?.total ?? 0);
};

/**
 * Saves the budget and logs the change. With no `version` it only adds one;
 * with a version it only saves if that still matches; 'any' adds or replaces.
 * Returns null when someone else got there first.
 */
export const writeBudget = async (
  tx: Tx,
  tripId: string,
  userId: string,
  values: BudgetValues,
  version?: number | 'any',
) => {
  const set = { mode: values.mode, totalMinor: values.totalMinor, categories: values.categories, updatedBy: userId };
  const [row] =
    version === undefined
      ? await tx.insert(budgets).values({ tripId, ...set }).onConflictDoNothing().returning()
      : version === 'any'
        ? await tx
            .insert(budgets)
            .values({ tripId, ...set })
            .onConflictDoUpdate({ target: budgets.tripId, set: { ...set, version: sql`${budgets.version} + 1` } })
            .returning()
        : await tx
            .update(budgets)
            .set({ ...set, version: sql`${budgets.version} + 1` })
            .where(and(eq(budgets.tripId, tripId), eq(budgets.version, version)))
            .returning();
  if (!row) return null;
  await tx.insert(changeLog).values({ tripId, entity: 'budget', entityId: tripId, op: 'upsert', changedBy: userId });
  await rearmAlerts(tx, row);
  return row;
};

/** Removes the budget and its alerts, so the trip shows nothing about budgets again. */
export const deleteBudget = async (tx: Tx, tripId: string, userId: string) => {
  const removed = await tx.delete(budgets).where(eq(budgets.tripId, tripId)).returning({ tripId: budgets.tripId });
  await tx.delete(budgetAlerts).where(eq(budgetAlerts.tripId, tripId));
  if (removed.length === 0) return false;
  await tx.insert(changeLog).values({ tripId, entity: 'budget', entityId: tripId, op: 'delete', changedBy: userId });
  return true;
};

/**
 * Edit trip's "Budget (optional)" row: sets the total and mode, keeping any
 * category limits. null, or no total with no limits left, removes the budget.
 * Returns what changed (the new budget, or null once removed), or null when
 * nothing did.
 */
export const editBudget = async (
  tx: Tx,
  tripId: string,
  userId: string,
  edit: { mode: BudgetMode; totalMinor: number | null } | null,
): Promise<{ budget: Budget | null } | null> => {
  const current = await loadBudget(tx, tripId);
  const categories = (current?.categories ?? {}) as BudgetCategories;
  if (edit === null || (edit.totalMinor === null && Object.keys(categories).length === 0)) {
    return (await deleteBudget(tx, tripId, userId)) ? { budget: null } : null;
  }
  if (current && current.mode === edit.mode && current.totalMinor === edit.totalMinor) return null;
  const row = await writeBudget(tx, tripId, userId, { ...edit, categories }, 'any');
  return { budget: toBudget(row!) };
};

/** A raised budget sends its 80% and 100% cards again once spending gets back there. */
const rearmAlerts = async (tx: Tx, row: BudgetRow) => {
  const limit = alertLimit(toBudget(row), await headcountOf(tx, row.tripId));
  const still = limit === null ? [] : reachedThresholds(await spentOn(tx, row.tripId), limit);
  await tx
    .delete(budgetAlerts)
    .where(
      still.length > 0
        ? and(eq(budgetAlerts.tripId, row.tripId), notInArray(budgetAlerts.threshold, [...still]))
        : eq(budgetAlerts.tripId, row.tripId),
    );
};

/** Tells everyone viewing the trip that the budget changed (null: it was removed). */
export const announceBudget = (redis: Redis, tripId: string, actorId: string, budget: Budget | null, origin?: string) =>
  publishTripEvent(redis, {
    type: 'budget.updated',
    tripId,
    entityId: tripId,
    actorId,
    version: budget?.version,
    payload: budget,
    originClientId: origin,
  });

/**
 * Posts "80% of the budget spent" and "Budget reached" in the chat, once
 * each. Runs after every expense write and budget change; the alerts table's
 * key makes sure two at once can't both post.
 */
export const checkBudgetAlerts = async (db: Db, redis: Redis | undefined, tripId: string, actorId: string) => {
  const row = await loadBudget(db, tripId);
  if (!row) return;
  const budget = toBudget(row);
  const limit = alertLimit(budget, await headcountOf(db, tripId));
  if (limit === null) return;
  const spent = await spentOn(db, tripId);
  const reached = reachedThresholds(spent, limit);
  if (reached.length === 0) return;
  const [trip] = await db.select({ base: trips.baseCurrency }).from(trips).where(eq(trips.id, tripId));
  const money = (minor: number) => formatMoney(minor, trip!.base, 'en-GB');
  const each = budget.mode === 'per_person' ? ` (${money(budget.totalMinor!)} each)` : '';

  const card = await db.transaction(async (tx) => {
    const fresh = await tx
      .insert(budgetAlerts)
      .values(reached.map((threshold) => ({ tripId, threshold })))
      .onConflictDoNothing()
      .returning({ threshold: budgetAlerts.threshold });
    if (fresh.length === 0) return null;
    // Jumping straight past both marks posts only the bigger news.
    const top = Math.max(...fresh.map((f) => f.threshold));
    const text =
      top >= 100
        ? `Budget reached: ${money(spent)} of ${money(limit)}${each} spent`
        : `${Math.floor((spent * 100) / limit)}% of the budget spent: ${money(spent)} of ${money(limit)}${each}`;
    return postSystemMessage(tx, tripId, actorId, () => text, { event: 'budget_alert', threshold: top });
  });
  if (card && redis) {
    await publishTripEvent(redis, { type: 'message.created', tripId, entityId: card.id, actorId, payload: card });
  }
};

/**
 * Costs in the plan with no expense yet, in the trip's currency: plan item
 * estimates (per person, so times everyone) and booking prices. A booking
 * with a price stands in for its item's estimate. Foreign amounts use
 * today's rate, and one with no rate is left out rather than guessed.
 */
export const plannedCosts = async (
  db: Db,
  rates: Rates,
  tripId: string,
  base: string,
  headcount: number,
): Promise<PlannedCost[]> => {
  const itemRows = await db
    .select({ id: items.id, title: items.title, type: items.type, cost: items.costEstimateMinor, currency: items.costCurrency })
    .from(items)
    .where(and(eq(items.tripId, tripId), isNull(items.deletedAt), isNotNull(items.costEstimateMinor), isNotNull(items.costCurrency)));
  const bookingRows = await db
    .select({
      id: bookings.id,
      itemId: bookings.itemId,
      type: bookings.type,
      provider: bookings.provider,
      itemTitle: items.title,
      cost: bookings.costMinor,
      currency: bookings.costCurrency,
    })
    .from(bookings)
    .leftJoin(items, and(eq(items.id, bookings.itemId), isNull(items.deletedAt)))
    .where(and(eq(bookings.tripId, tripId), isNull(bookings.deletedAt), isNotNull(bookings.costMinor), isNotNull(bookings.costCurrency)));
  const links = await db
    .select({ itemId: expenses.itemId, bookingId: expenses.bookingId })
    .from(expenses)
    .where(and(eq(expenses.tripId, tripId), isNull(expenses.deletedAt)));

  const quotes = new Map<string, number | null>();
  const toBase = async (amount: number, currency: string) => {
    const from = currency.trim();
    if (!quotes.has(from)) {
      quotes.set(from, from === base ? 1 : ((await rates.quote(from, base).catch(() => null))?.rate ?? null));
    }
    const rate = quotes.get(from);
    return rate ? convertMinor(amount, from, base, rate) : null;
  };

  const booked = new Set(bookingRows.map((b) => b.itemId).filter(Boolean));
  const planned: PlannedCost[] = [];
  for (const i of itemRows) {
    if (booked.has(i.id)) continue;
    const amount = await toBase(i.cost! * Math.max(1, headcount), i.currency!);
    if (amount) planned.push({ itemId: i.id, bookingId: null, title: i.title, category: categoryFor(i.type), amountMinor: amount });
  }
  for (const b of bookingRows) {
    const amount = await toBase(b.cost!, b.currency!);
    const title = b.itemTitle ?? b.provider ?? b.type.charAt(0).toUpperCase() + b.type.slice(1);
    if (amount) planned.push({ itemId: b.itemId, bookingId: b.id, title, category: categoryFor(b.type), amountMinor: amount });
  }
  return unlinkedPlanned(planned, links);
};
