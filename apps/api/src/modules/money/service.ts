import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  bookings,
  changeLog,
  expenseSplits,
  expenses,
  items,
  messages,
  settlements,
  tripMembers,
  trips,
  users,
  type Db,
  type Tx,
} from '@tagalong/db';
import {
  computeBalances,
  convertMinor,
  CreateExpenseInput,
  CreateSettlementInput,
  formatMoney,
  hasRole,
  newId,
  splitExpense,
  suggestTransfers,
  UpdateExpenseInput,
  type ChatMessage,
  type Expense,
  type ExpenseCategory,
  type FxQuote,
  type MoneyPerson,
  type Settlement,
  type SettlementMethod,
  type SplitMethod,
  type TripEvent,
  type TripMoney,
} from '@tagalong/shared';
import type { Redis } from 'ioredis';
import type { z } from 'zod';
import { requireTripRole } from '../../lib/access';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors';
import { publishTripEvent } from '../../lib/events';
import type { Rates } from '../../lib/fx';
import { postSystemMessage } from '../chat/channel';

type CreateExpense = z.output<typeof CreateExpenseInput>;
type UpdateExpense = z.output<typeof UpdateExpenseInput>;
type CreateSettlement = z.output<typeof CreateSettlementInput>;
type ExpenseRow = typeof expenses.$inferSelect;
type SettlementRow = typeof settlements.$inferSelect;
type SplitRow = typeof expenseSplits.$inferSelect;

const toExpense = (r: ExpenseRow, splits: SplitRow[]): Expense => ({
  id: r.id,
  tripId: r.tripId,
  paidBy: r.paidBy,
  description: r.description,
  category: r.category as ExpenseCategory,
  amountMinor: r.amountMinor,
  currency: r.currency,
  fxRate: Number(r.fxRate),
  baseAmountMinor: r.baseAmountMinor,
  spentOn: r.spentOn,
  splitMethod: r.splitMethod as SplitMethod,
  splits: splits
    .map((s) => ({ userId: s.userId, value: s.value, shareMinor: s.shareMinor }))
    .sort((a, b) => (a.userId < b.userId ? -1 : 1)),
  itemId: r.itemId,
  bookingId: r.bookingId,
  sourceMessageId: r.sourceMessageId,
  createdBy: r.createdBy,
  version: r.version,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
});

const toSettlement = (r: SettlementRow): Settlement => ({
  id: r.id,
  tripId: r.tripId,
  fromUser: r.fromUser,
  toUser: r.toUser,
  amountMinor: r.amountMinor,
  method: r.method as SettlementMethod,
  note: r.note,
  settledAt: r.settledAt.toISOString(),
  createdBy: r.createdBy,
  version: r.version,
});

export const createMoneyService = (db: Db, redis: Redis, rates: Rates) => {
  const splitsOf = async (dbOrTx: Db | Tx, expenseIds: string[]) => {
    const bucket = new Map<string, SplitRow[]>();
    if (expenseIds.length === 0) return bucket;
    const rows = await dbOrTx
      .select()
      .from(expenseSplits)
      .where(inArray(expenseSplits.expenseId, expenseIds));
    for (const row of rows) bucket.set(row.expenseId, [...(bucket.get(row.expenseId) ?? []), row]);
    return bucket;
  };

  const hydrate = async (dbOrTx: Db | Tx, row: ExpenseRow) =>
    toExpense(row, (await splitsOf(dbOrTx, [row.id])).get(row.id) ?? []);

  const loadExpense = async (expenseId: string) => {
    const [row] = await db
      .select()
      .from(expenses)
      .where(and(eq(expenses.id, expenseId), isNull(expenses.deletedAt)));
    if (!row) throw notFound('That expense no longer exists');
    return row;
  };

  const baseCurrencyOf = async (tripId: string) => {
    const [trip] = await db.select({ base: trips.baseCurrency }).from(trips).where(eq(trips.id, tripId));
    return trip!.base;
  };

  /** Ids of everyone currently on the trip. */
  const activeMembers = async (dbOrTx: Db | Tx, tripId: string) =>
    new Set(
      (
        await dbOrTx
          .select({ userId: tripMembers.userId })
          .from(tripMembers)
          .where(and(eq(tripMembers.tripId, tripId), isNull(tripMembers.leftAt)))
      ).map((r) => r.userId),
    );

  /**
   * Who paid and who shares must be on the trip. When editing, people already
   * on the expense may stay even if they've since left, so an old expense can
   * still be corrected.
   */
  const checkPeople = async (tx: Tx, tripId: string, people: string[], alreadyOn: string[] = []) => {
    const active = await activeMembers(tx, tripId);
    for (const userId of people) {
      if (!active.has(userId) && !alreadyOn.includes(userId)) {
        throw badRequest('Everyone in an expense needs to be on the trip');
      }
    }
  };

  /** An expense may only point at a plan item, booking or message from its own trip. */
  const checkLinks = async (
    tx: Tx,
    tripId: string,
    links: { itemId?: string | null; bookingId?: string | null; sourceMessageId?: string | null },
  ) => {
    const checks: [string | null | undefined, () => Promise<{ tripId: string }[]>][] = [
      [links.itemId, () => tx.select({ tripId: items.tripId }).from(items).where(and(eq(items.id, links.itemId!), isNull(items.deletedAt)))],
      [links.bookingId, () => tx.select({ tripId: bookings.tripId }).from(bookings).where(and(eq(bookings.id, links.bookingId!), isNull(bookings.deletedAt)))],
      [links.sourceMessageId, () => tx.select({ tripId: messages.tripId }).from(messages).where(and(eq(messages.id, links.sourceMessageId!), isNull(messages.deletedAt)))],
    ];
    for (const [id, find] of checks) {
      if (!id) continue;
      const [row] = await find();
      if (row?.tripId !== tripId) throw badRequest('That link isn’t on this trip');
    }
  };

  /** The rate to log an expense with: the one given, or today's published rate. */
  const rateFor = async (currency: string, base: string, given?: number) => {
    if (currency === base) return 1;
    if (given) return given;
    const quote = await rates.quote(currency, base).catch(() => null);
    if (!quote) {
      throw badRequest(`We couldn’t find a rate for ${currency}. Enter it yourself.`, 'rate_needed');
    }
    return quote.rate;
  };

  /** Works out each person's share, or explains what doesn't add up. */
  const shares = (
    method: SplitMethod,
    entries: { userId: string; value: number }[],
    amountMinor: number,
    baseMinor: number,
  ) => {
    const result = splitExpense(method, entries, amountMinor, baseMinor);
    if (!result.ok) throw badRequest(result.error, 'bad_split');
    return result.shares;
  };

  const publishCard = (tripId: string, actorId: string, card: ChatMessage | null) =>
    card
      ? publishTripEvent(redis, {
          type: 'message.created',
          tripId,
          entityId: card.id,
          actorId,
          payload: card,
        })
      : undefined;

  const announce = (event: Omit<TripEvent, 'originClientId'>, origin?: string) =>
    publishTripEvent(redis, { ...event, originClientId: origin });

  return {
    /** Today's rate, so the phone can show what a foreign amount comes to. */
    async quote(from: string, to: string): Promise<FxQuote> {
      const quote = await rates.quote(from, to).catch(() => null);
      if (!quote) throw notFound(`We couldn’t find a rate for ${from}. Enter it yourself.`);
      return quote;
    },

    /** Everything the Money tab needs: expenses, payments, people and balances. */
    async summary(tripId: string, userId: string): Promise<TripMoney> {
      await requireTripRole(db, tripId, userId, 'viewer');
      const baseCurrency = await baseCurrencyOf(tripId);
      const expenseRows = await db
        .select()
        .from(expenses)
        .where(and(eq(expenses.tripId, tripId), isNull(expenses.deletedAt)))
        .orderBy(desc(expenses.spentOn), desc(expenses.createdAt));
      const splits = await splitsOf(db, expenseRows.map((e) => e.id));
      const list = expenseRows.map((r) => toExpense(r, splits.get(r.id) ?? []));
      const settled = (
        await db
          .select()
          .from(settlements)
          .where(and(eq(settlements.tripId, tripId), isNull(settlements.deletedAt)))
          .orderBy(desc(settlements.settledAt))
      ).map(toSettlement);

      // Everyone on the trip, plus anyone who left but still appears in the money.
      const involved = new Set<string>();
      for (const e of list) {
        involved.add(e.paidBy);
        for (const s of e.splits) involved.add(s.userId);
      }
      for (const s of settled) involved.add(s.fromUser).add(s.toUser);
      const memberRows = await db
        .select({ userId: tripMembers.userId, displayName: users.displayName, leftAt: tripMembers.leftAt })
        .from(tripMembers)
        .innerJoin(users, eq(users.id, tripMembers.userId))
        .where(eq(tripMembers.tripId, tripId))
        .orderBy(asc(tripMembers.joinedAt));
      const people: MoneyPerson[] = memberRows
        .filter((m) => m.leftAt === null || involved.has(m.userId))
        .map((m) => ({ userId: m.userId, displayName: m.displayName, active: m.leftAt === null }));

      const net = computeBalances(list, settled);
      for (const p of people) if (!net.has(p.userId)) net.set(p.userId, 0);
      return {
        baseCurrency,
        expenses: list,
        settlements: settled,
        people,
        balances: [...net].map(([id, netMinor]) => ({ userId: id, netMinor })),
        suggested: suggestTransfers(net),
      };
    },

    /** Retrying with the same client-generated id returns the same expense. */
    async create(tripId: string, userId: string, input: CreateExpense, origin?: string) {
      await requireTripRole(db, tripId, userId, 'editor');
      const base = await baseCurrencyOf(tripId);
      const fxRate = await rateFor(input.currency, base, input.fxRate);
      const baseAmountMinor = convertMinor(input.amountMinor, input.currency, base, fxRate);
      const split = shares(input.splitMethod, input.splits, input.amountMinor, baseAmountMinor);
      const id = input.id ?? newId();

      const result = await db.transaction(async (tx) => {
        await checkPeople(tx, tripId, [input.paidBy, ...split.map((s) => s.userId)]);
        await checkLinks(tx, tripId, input);
        const [inserted] = await tx
          .insert(expenses)
          .values({
            id,
            tripId,
            paidBy: input.paidBy,
            description: input.description,
            category: input.category,
            amountMinor: input.amountMinor,
            currency: input.currency,
            fxRate: String(fxRate),
            baseAmountMinor,
            spentOn: input.spentOn,
            splitMethod: input.splitMethod,
            itemId: input.itemId ?? null,
            bookingId: input.bookingId ?? null,
            sourceMessageId: input.sourceMessageId ?? null,
            createdBy: userId,
          })
          .onConflictDoNothing()
          .returning();

        if (!inserted) {
          const [existing] = await tx.select().from(expenses).where(eq(expenses.id, id));
          if (!existing || existing.tripId !== tripId || existing.createdBy !== userId) {
            throw conflict('An expense with that id already exists');
          }
          return { expense: await hydrate(tx, existing), created: false, card: null };
        }

        await tx.insert(expenseSplits).values(split.map((s) => ({ expenseId: id, ...s })));
        await tx.insert(changeLog).values({ tripId, entity: 'expense', entityId: id, op: 'upsert', changedBy: userId });
        const card = await postSystemMessage(
          tx,
          tripId,
          userId,
          (name) => `${name} added ${input.description} · ${formatMoney(input.amountMinor, input.currency, 'en-GB')}`,
          { event: 'expense_added', expenseId: id },
        );
        return { expense: await hydrate(tx, inserted), created: true, card };
      });

      if (result.created) {
        await announce(
          { type: 'expense.upserted', tripId, entityId: id, actorId: userId, version: result.expense.version, payload: result.expense },
          origin,
        );
        await publishCard(tripId, userId, result.card);
      }
      return { expense: result.expense, created: result.created };
    },

    /**
     * Saves only if `version` still matches. The rate stays frozen unless the
     * currency changes or a new rate is given, and the shares are worked out
     * again whenever anything they depend on changes.
     */
    async update(expenseId: string, userId: string, input: UpdateExpense, origin?: string) {
      const current = await loadExpense(expenseId);
      await requireTripRole(db, current.tripId, userId, 'editor');
      const { version, splits: newEntries, ...fields } = input;
      const base = await baseCurrencyOf(current.tripId);
      const before = (await splitsOf(db, [expenseId])).get(expenseId) ?? [];

      const currency = fields.currency ?? current.currency;
      const amountMinor = fields.amountMinor ?? current.amountMinor;
      const fxRate =
        fields.fxRate !== undefined || fields.currency !== undefined
          ? await rateFor(currency, base, fields.fxRate)
          : Number(current.fxRate);
      const baseAmountMinor = convertMinor(amountMinor, currency, base, fxRate);
      const method = fields.splitMethod ?? (current.splitMethod as SplitMethod);
      const entries = newEntries ?? before.map((s) => ({ userId: s.userId, value: s.value }));
      const split = shares(method, entries, amountMinor, baseAmountMinor);

      const updated = await db.transaction(async (tx) => {
        const alreadyOn = [current.paidBy, ...before.map((s) => s.userId)];
        await checkPeople(tx, current.tripId, [fields.paidBy ?? current.paidBy, ...split.map((s) => s.userId)], alreadyOn);
        await checkLinks(tx, current.tripId, fields);
        const [row] = await tx
          .update(expenses)
          .set({
            ...Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)),
            // Last, so it replaces the number that came in with the stored text.
            fxRate: String(fxRate),
            baseAmountMinor,
            version: sql`${expenses.version} + 1`,
          })
          .where(and(eq(expenses.id, expenseId), eq(expenses.version, version), isNull(expenses.deletedAt)))
          .returning();
        if (!row) return null;
        await tx.delete(expenseSplits).where(eq(expenseSplits.expenseId, expenseId));
        await tx.insert(expenseSplits).values(split.map((s) => ({ expenseId, ...s })));
        await tx.insert(changeLog).values({
          tripId: row.tripId,
          entity: 'expense',
          entityId: expenseId,
          op: 'upsert',
          changedBy: userId,
        });
        return hydrate(tx, row);
      });

      if (!updated) {
        const latest = await loadExpense(expenseId);
        throw conflict('Someone changed this while you were editing. Showing the latest version.', {
          current: await hydrate(db, latest),
        });
      }
      await announce(
        { type: 'expense.upserted', tripId: updated.tripId, entityId: expenseId, actorId: userId, version: updated.version, payload: updated },
        origin,
      );
      return updated;
    },

    async removeExpense(expenseId: string, userId: string, origin?: string) {
      const current = await loadExpense(expenseId);
      await requireTripRole(db, current.tripId, userId, 'editor');
      const deleted = await db.transaction(async (tx) => {
        const [row] = await tx
          .update(expenses)
          .set({ deletedAt: new Date(), version: sql`${expenses.version} + 1` })
          .where(and(eq(expenses.id, expenseId), isNull(expenses.deletedAt)))
          .returning({ version: expenses.version });
        if (!row) return null;
        await tx.insert(changeLog).values({
          tripId: current.tripId,
          entity: 'expense',
          entityId: expenseId,
          op: 'delete',
          changedBy: userId,
        });
        return row;
      });
      if (!deleted) return;
      await announce(
        { type: 'expense.deleted', tripId: current.tripId, entityId: expenseId, actorId: userId, version: deleted.version },
        origin,
      );
    },

    /**
     * Records money changing hands. Editors can record any payment; a viewer
     * can record one they're part of, since paying back is their business too.
     */
    async settle(tripId: string, userId: string, input: CreateSettlement, origin?: string) {
      const role = await requireTripRole(db, tripId, userId, 'viewer');
      const involved = input.fromUser === userId || input.toUser === userId;
      if (!hasRole(role, 'editor') && !involved) throw forbidden('You can only record payments you’re part of');
      const id = input.id ?? newId();
      const base = await baseCurrencyOf(tripId);

      const result = await db.transaction(async (tx) => {
        // Someone who left can still be paid back, so any past member counts.
        const known = await tx
          .select({ userId: tripMembers.userId })
          .from(tripMembers)
          .where(and(eq(tripMembers.tripId, tripId), inArray(tripMembers.userId, [input.fromUser, input.toUser])));
        if (known.length !== 2) throw badRequest('Both people need to be on the trip');

        const [inserted] = await tx
          .insert(settlements)
          .values({
            id,
            tripId,
            fromUser: input.fromUser,
            toUser: input.toUser,
            amountMinor: input.amountMinor,
            method: input.method,
            note: input.note ?? null,
            createdBy: userId,
          })
          .onConflictDoNothing()
          .returning();
        if (!inserted) {
          const [existing] = await tx.select().from(settlements).where(eq(settlements.id, id));
          if (!existing || existing.tripId !== tripId || existing.createdBy !== userId) {
            throw conflict('A payment with that id already exists');
          }
          return { settlement: toSettlement(existing), created: false, card: null };
        }
        await tx.insert(changeLog).values({ tripId, entity: 'settlement', entityId: id, op: 'upsert', changedBy: userId });
        const [from, to] = await Promise.all(
          [input.fromUser, input.toUser].map(async (uid) => {
            const [u] = await tx.select({ name: users.displayName }).from(users).where(eq(users.id, uid));
            return u?.name ?? 'Someone';
          }),
        );
        const card = await postSystemMessage(
          tx,
          tripId,
          userId,
          () => `${from} paid ${to} ${formatMoney(input.amountMinor, base, 'en-GB')}`,
          { event: 'settlement_added', settlementId: id },
        );
        return { settlement: toSettlement(inserted), created: true, card };
      });

      if (result.created) {
        await announce(
          { type: 'settlement.upserted', tripId, entityId: id, actorId: userId, version: result.settlement.version, payload: result.settlement },
          origin,
        );
        await publishCard(tripId, userId, result.card);
      }
      return result;
    },

    /** Undoes a payment recorded by mistake. */
    async removeSettlement(settlementId: string, userId: string, origin?: string) {
      const [current] = await db
        .select()
        .from(settlements)
        .where(and(eq(settlements.id, settlementId), isNull(settlements.deletedAt)));
      if (!current) throw notFound('That payment no longer exists');
      const role = await requireTripRole(db, current.tripId, userId, 'viewer');
      const involved = current.fromUser === userId || current.toUser === userId;
      if (!hasRole(role, 'editor') && !involved) throw forbidden('You can only undo payments you’re part of');

      const deleted = await db.transaction(async (tx) => {
        const [row] = await tx
          .update(settlements)
          .set({ deletedAt: new Date(), version: sql`${settlements.version} + 1` })
          .where(and(eq(settlements.id, settlementId), isNull(settlements.deletedAt)))
          .returning({ version: settlements.version });
        if (!row) return null;
        await tx.insert(changeLog).values({
          tripId: current.tripId,
          entity: 'settlement',
          entityId: settlementId,
          op: 'delete',
          changedBy: userId,
        });
        return row;
      });
      if (!deleted) return;
      await announce(
        { type: 'settlement.deleted', tripId: current.tripId, entityId: settlementId, actorId: userId, version: deleted.version },
        origin,
      );
    },
  };
};
