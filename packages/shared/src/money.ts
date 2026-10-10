/**
 * Money math shared by the API and the phone. Amounts are always whole minor
 * units (cents) in integers, never floats, so splits add up to the cent.
 */

/** Currencies with no minor unit: ¥1,000 is stored as 1000, not 100000. */
const ZERO_DECIMAL = new Set(['JPY', 'KRW', 'VND', 'ISK', 'CLP', 'PYG', 'UGX', 'XAF', 'XOF']);

export const minorDigits = (currency: string) => (ZERO_DECIMAL.has(currency.toUpperCase()) ? 0 : 2);

/** "12.50" in EUR → 1250; "1000" in JPY → 1000. Returns null for anything that isn't an amount. */
export const parseAmount = (text: string, currency: string): number | null => {
  const clean = text.trim().replace(/\s/g, '').replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(clean)) return null;
  const digits = minorDigits(currency);
  const [whole, fraction = ''] = clean.split('.');
  if (fraction.length > digits) return null;
  return Number(whole) * 10 ** digits + Number(fraction.padEnd(digits, '0') || 0);
};

/** 1250 in EUR → "12.50", for putting back into a text field. */
export const amountText = (minor: number, currency: string) => {
  const digits = minorDigits(currency);
  return digits === 0 ? String(minor) : (minor / 10 ** digits).toFixed(digits);
};

/** "€12.50", "€12" for whole amounts, "¥1,000"; "12.50 XYZ" where a currency isn't known. */
export const formatMoney = (minor: number, currency: string, locale?: string) => {
  const digits = minorDigits(currency);
  const whole = minor % 10 ** digits === 0;
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: whole ? 0 : digits,
      maximumFractionDigits: digits,
    }).format(minor / 10 ** digits);
  } catch {
    return `${amountText(minor, currency)} ${currency}`;
  }
};

/** Converts an amount between currencies at `rate` (1 `from` = `rate` `to`), rounded to the cent. */
export const convertMinor = (amountMinor: number, from: string, to: string, rate: number) => {
  if (from === to) return amountMinor;
  const major = amountMinor / 10 ** minorDigits(from);
  return Math.round(major * rate * 10 ** minorDigits(to));
};

/**
 * Splits `total` in proportion to `weights` so the parts add up exactly. Each
 * part is rounded down and the leftover cents go to the largest remainders,
 * ties to the earliest entry, so the same input always gives the same split.
 */
export const allocate = (total: number, weights: number[]): number[] => {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0) throw new Error('Nothing to split by');
  const exact = weights.map((w) => (total * w) / sum);
  const parts = exact.map(Math.floor);
  let left = total - parts.reduce((a, b) => a + b, 0);
  const order = exact
    .map((x, i) => ({ i, rest: x - Math.floor(x) }))
    .sort((a, b) => b.rest - a.rest || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    parts[i]! += 1;
    left -= 1;
  }
  return parts;
};

export const SPLIT_METHODS = ['equal', 'exact', 'percent', 'shares'] as const;
export type SplitMethod = (typeof SPLIT_METHODS)[number];

/**
 * One person in a split. What `value` means depends on the method: ignored
 * for `equal`, an amount in the expense's currency for `exact`, basis points
 * (2500 = 25%) for `percent`, and a count for `shares` (a couple is 2).
 */
export interface SplitEntry {
  userId: string;
  value: number;
}

export type SplitResult =
  | { ok: true; shares: { userId: string; value: number; shareMinor: number }[] }
  | { ok: false; error: string };

/**
 * Who owes what of an expense, in the trip's currency. `amountMinor` is in the
 * expense's own currency (what `exact` values are entered in) and `baseMinor`
 * is the same amount converted, which the shares must add up to exactly.
 */
export const splitExpense = (
  method: SplitMethod,
  entries: SplitEntry[],
  amountMinor: number,
  baseMinor: number,
): SplitResult => {
  if (entries.length === 0) return { ok: false, error: 'Choose who this is shared by' };
  if (new Set(entries.map((e) => e.userId)).size !== entries.length) {
    return { ok: false, error: 'Someone is in the split twice' };
  }
  // Sorting first makes the rounding independent of the order people were picked in.
  const sorted = [...entries].sort((a, b) => (a.userId < b.userId ? -1 : 1));
  const values = sorted.map((e) => (method === 'equal' ? 1 : e.value));
  if (values.some((v) => !Number.isInteger(v) || v < 0)) {
    return { ok: false, error: 'Use whole, positive numbers' };
  }
  const sum = values.reduce((a, b) => a + b, 0);

  if (method === 'exact' && sum !== amountMinor) {
    return { ok: false, error: 'The amounts don’t add up to the total' };
  }
  if (method === 'percent' && sum !== 10_000) {
    return { ok: false, error: 'The percentages need to add up to 100%' };
  }
  if (method === 'shares' && sum === 0) {
    return { ok: false, error: 'Give at least one person a share' };
  }

  const parts = allocate(baseMinor, values);
  return {
    ok: true,
    shares: sorted.map((e, i) => ({ userId: e.userId, value: values[i]!, shareMinor: parts[i]! })),
  };
};

export interface LedgerExpense {
  paidBy: string;
  baseAmountMinor: number;
  splits: { userId: string; shareMinor: number }[];
}

export interface LedgerSettlement {
  fromUser: string;
  toUser: string;
  amountMinor: number;
}

/**
 * Everyone's position, in the trip's currency: positive means the group owes
 * them, negative means they owe the group. Always adds up to zero.
 */
export const computeBalances = (
  expenses: LedgerExpense[],
  settlements: LedgerSettlement[],
): Map<string, number> => {
  const net = new Map<string, number>();
  const add = (userId: string, amount: number) => net.set(userId, (net.get(userId) ?? 0) + amount);
  for (const e of expenses) {
    add(e.paidBy, e.baseAmountMinor);
    for (const s of e.splits) add(s.userId, -s.shareMinor);
  }
  // Paying someone back moves you up and them down by the same amount.
  for (const s of settlements) {
    add(s.fromUser, s.amountMinor);
    add(s.toUser, -s.amountMinor);
  }
  return net;
};

export interface Transfer {
  fromUser: string;
  toUser: string;
  amountMinor: number;
}

/**
 * Payments that clear every balance: the biggest debtor pays the biggest
 * creditor, again and again. That never needs more than one payment fewer
 * than there are people, and usually far fewer. Ties go by user id, so every
 * phone suggests the same payments.
 */
export const suggestTransfers = (balances: Map<string, number>): Transfer[] => {
  const byAmount = (a: [string, number], b: [string, number]) =>
    Math.abs(b[1]) - Math.abs(a[1]) || (a[0] < b[0] ? -1 : 1);
  const debtors = [...balances].filter(([, v]) => v < 0).sort(byAmount);
  const creditors = [...balances].filter(([, v]) => v > 0).sort(byAmount);
  const transfers: Transfer[] = [];

  while (debtors.length > 0 && creditors.length > 0) {
    const debtor = debtors[0]!;
    const creditor = creditors[0]!;
    const amount = Math.min(-debtor[1], creditor[1]);
    transfers.push({ fromUser: debtor[0], toUser: creditor[0], amountMinor: amount });
    debtor[1] += amount;
    creditor[1] -= amount;
    if (debtor[1] === 0) debtors.shift();
    if (creditor[1] === 0) creditors.shift();
    debtors.sort(byAmount);
    creditors.sort(byAmount);
  }
  return transfers;
};

/**
 * The first amount written in a chat message, like "taxi was €18.50" or
 * "paid 45 for dinner", to prefill an expense. A time ("at 19:30") or a date
 * doesn't count.
 */
export const guessAmount = (text: string, currency: string): number | null => {
  const match = text.match(/(?:^|[^\d:/.,])(\d{1,7}(?:[.,]\d{1,2})?)(?![\d:/])/);
  if (!match) return null;
  return parseAmount(match[1]!, currency);
};

const csvCell = (value: string | number) => {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export interface CsvExpense {
  spentOn: string;
  description: string;
  category: string;
  paidByName: string;
  amountMinor: number;
  currency: string;
  baseAmountMinor: number;
  shares: { name: string; shareMinor: number }[];
}

/** A spreadsheet of the trip's expenses, one column per person for their share. */
export const expensesCsv = (expenses: CsvExpense[], people: string[], baseCurrency: string) => {
  const header = ['Date', 'Description', 'Category', 'Paid by', 'Amount', 'Currency', `Amount (${baseCurrency})`, ...people];
  const rows = expenses.map((e) => {
    const shareOf = new Map(e.shares.map((s) => [s.name, s.shareMinor]));
    return [
      e.spentOn,
      e.description,
      e.category,
      e.paidByName,
      amountText(e.amountMinor, e.currency),
      e.currency,
      amountText(e.baseAmountMinor, baseCurrency),
      ...people.map((p) => (shareOf.has(p) ? amountText(shareOf.get(p)!, baseCurrency) : '')),
    ];
  });
  return [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\n');
};
