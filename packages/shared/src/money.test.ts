import { describe, expect, it } from 'vitest';
import {
  allocate,
  amountText,
  computeBalances,
  convertMinor,
  expensesCsv,
  formatMoney,
  guessAmount,
  parseAmount,
  splitExpense,
  suggestTransfers,
} from './money';

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe('amounts', () => {
  it('reads what people type, in cents', () => {
    expect(parseAmount('12.50', 'EUR')).toBe(1250);
    expect(parseAmount('12,5', 'EUR')).toBe(1250);
    expect(parseAmount(' 7 ', 'EUR')).toBe(700);
    expect(parseAmount('1000', 'JPY')).toBe(1000);
  });

  it('refuses things that aren’t amounts', () => {
    expect(parseAmount('', 'EUR')).toBeNull();
    expect(parseAmount('-5', 'EUR')).toBeNull();
    expect(parseAmount('12.505', 'EUR')).toBeNull();
    expect(parseAmount('10.5', 'JPY')).toBeNull();
    expect(parseAmount('ten', 'EUR')).toBeNull();
  });

  it('writes cents back as text for editing', () => {
    expect(amountText(1250, 'EUR')).toBe('12.50');
    expect(amountText(1000, 'JPY')).toBe('1000');
  });

  it('formats amounts for people, dropping .00 on whole amounts', () => {
    expect(formatMoney(1250, 'EUR', 'en-GB')).toBe('€12.50');
    expect(formatMoney(1200, 'EUR', 'en-GB')).toBe('€12');
    expect(formatMoney(1000, 'JPY', 'en-GB')).toBe('JP¥1,000');
  });

  it('converts between currencies, minding which have cents', () => {
    expect(convertMinor(10_000, 'USD', 'EUR', 0.89238)).toBe(8924);
    expect(convertMinor(5000, 'JPY', 'EUR', 0.0061)).toBe(3050);
    expect(convertMinor(1999, 'EUR', 'EUR', 2)).toBe(1999);
  });
});

describe('allocate', () => {
  it('always adds up to the total, giving leftover cents to the biggest remainders', () => {
    expect(allocate(1000, [1, 1, 1])).toEqual([334, 333, 333]);
    expect(allocate(100, [1, 2])).toEqual([33, 67]);
    for (const total of [1, 7, 999, 123_457]) {
      expect(sum(allocate(total, [3, 1, 4, 1, 5]))).toBe(total);
    }
  });
});

describe('splitExpense', () => {
  const people = (...ids: string[]) => ids.map((userId) => ({ userId, value: 0 }));

  it('splits equally, and the odd cent goes to the same person whatever order they were picked in', () => {
    const a = splitExpense('equal', people('c', 'a', 'b'), 1000, 1000);
    const b = splitExpense('equal', people('b', 'c', 'a'), 1000, 1000);
    expect(a).toEqual(b);
    expect(a.ok && a.shares.map((s) => [s.userId, s.shareMinor])).toEqual([
      ['a', 334],
      ['b', 333],
      ['c', 333],
    ]);
  });

  it('takes exact amounts, which must add up to the total', () => {
    const ok = splitExpense('exact', [{ userId: 'a', value: 700 }, { userId: 'b', value: 300 }], 1000, 1000);
    expect(ok.ok && ok.shares.map((s) => s.shareMinor)).toEqual([700, 300]);
    const short = splitExpense('exact', [{ userId: 'a', value: 700 }, { userId: 'b', value: 200 }], 1000, 1000);
    expect(short).toMatchObject({ ok: false });
  });

  it('carries exact amounts across to the trip currency in proportion', () => {
    // $100 split 75/25, converted to €89.24.
    const r = splitExpense('exact', [{ userId: 'a', value: 7500 }, { userId: 'b', value: 2500 }], 10_000, 8924);
    expect(r.ok && r.shares.map((s) => s.shareMinor)).toEqual([6693, 2231]);
  });

  it('splits by percent, which must make 100%', () => {
    const r = splitExpense(
      'percent',
      [{ userId: 'a', value: 3333 }, { userId: 'b', value: 3333 }, { userId: 'c', value: 3334 }],
      10_001,
      10_001,
    );
    expect(r.ok && sum(r.shares.map((s) => s.shareMinor))).toBe(10_001);
    expect(splitExpense('percent', [{ userId: 'a', value: 5000 }], 100, 100)).toMatchObject({ ok: false });
  });

  it('splits by shares, so a couple can count as two', () => {
    const r = splitExpense('shares', [{ userId: 'couple', value: 2 }, { userId: 'solo', value: 1 }], 9000, 9000);
    expect(r.ok && r.shares.map((s) => [s.userId, s.shareMinor])).toEqual([
      ['couple', 6000],
      ['solo', 3000],
    ]);
  });

  it('refuses nobody, the same person twice, and fractions', () => {
    expect(splitExpense('equal', [], 100, 100)).toMatchObject({ ok: false });
    expect(splitExpense('equal', people('a', 'a'), 100, 100)).toMatchObject({ ok: false });
    expect(splitExpense('shares', [{ userId: 'a', value: 1.5 }], 100, 100)).toMatchObject({ ok: false });
  });
});

describe('balances and settling up', () => {
  // Alex paid €90 for dinner for three; Sam paid €30 for a taxi for Sam and Priya.
  const expenses = [
    {
      paidBy: 'alex',
      baseAmountMinor: 9000,
      splits: [
        { userId: 'alex', shareMinor: 3000 },
        { userId: 'priya', shareMinor: 3000 },
        { userId: 'sam', shareMinor: 3000 },
      ],
    },
    {
      paidBy: 'sam',
      baseAmountMinor: 3000,
      splits: [
        { userId: 'priya', shareMinor: 1500 },
        { userId: 'sam', shareMinor: 1500 },
      ],
    },
  ];

  it('works out who is owed and who owes, adding up to zero', () => {
    const b = computeBalances(expenses, []);
    expect(Object.fromEntries(b)).toEqual({ alex: 6000, priya: -4500, sam: -1500 });
    expect(sum([...b.values()])).toBe(0);
  });

  it('suggests payments that clear everything', () => {
    const transfers = suggestTransfers(computeBalances(expenses, []));
    expect(transfers).toEqual([
      { fromUser: 'priya', toUser: 'alex', amountMinor: 4500 },
      { fromUser: 'sam', toUser: 'alex', amountMinor: 1500 },
    ]);
    // Recording them brings everyone back to zero.
    const after = computeBalances(expenses, transfers);
    expect([...after.values()].every((v) => v === 0)).toBe(true);
    expect(suggestTransfers(after)).toEqual([]);
  });

  it('needs fewer payments than people, even in a tangle', () => {
    const balances = new Map([
      ['a', 5000],
      ['b', 2500],
      ['c', -1000],
      ['d', -4000],
      ['e', -2500],
    ]);
    const transfers = suggestTransfers(balances);
    expect(transfers.length).toBeLessThan(balances.size);
    expect([...computeBalances([], transfers)].every(([id, v]) => v === -balances.get(id)!)).toBe(true);
  });
});

describe('guessAmount', () => {
  it('finds the amount in a chat message', () => {
    expect(guessAmount('Taxi was €18.50, I paid', 'EUR')).toBe(1850);
    expect(guessAmount('paid 45 for dinner', 'EUR')).toBe(4500);
  });

  it('skips times and dates', () => {
    expect(guessAmount('dinner at 19:30', 'EUR')).toBeNull();
    expect(guessAmount('on 12/06 we go', 'EUR')).toBeNull();
    expect(guessAmount('no money here', 'EUR')).toBeNull();
  });
});

describe('expensesCsv', () => {
  it('lays expenses out with a column per person, quoting where needed', () => {
    const csv = expensesCsv(
      [
        {
          spentOn: '2026-06-12',
          description: 'Dinner, Time Out Market',
          category: 'food',
          paidByName: 'Alex',
          amountMinor: 9000,
          currency: 'EUR',
          baseAmountMinor: 9000,
          shares: [
            { name: 'Alex', shareMinor: 4500 },
            { name: 'Sam', shareMinor: 4500 },
          ],
        },
      ],
      ['Alex', 'Priya', 'Sam'],
      'EUR',
    );
    expect(csv.split('\n')).toEqual([
      'Date,Description,Category,Paid by,Amount,Currency,Amount (EUR),Alex,Priya,Sam',
      '2026-06-12,"Dinner, Time Out Market",food,Alex,90.00,EUR,90.00,45.00,,45.00',
    ]);
  });
});
