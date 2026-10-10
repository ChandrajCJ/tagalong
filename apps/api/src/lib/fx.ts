import type { FxQuote } from '@tagalong/shared';
import type { Redis } from 'ioredis';

/** Exchange rates. Swapped for fixed rates in tests. */
export interface Rates {
  /** 1 `from` in `to`, or null when there's no published rate for that pair. */
  quote(from: string, to: string): Promise<FxQuote | null>;
}

const DAY_SEC = 24 * 60 * 60;

/**
 * Daily reference rates from the European Central Bank, through Frankfurter
 * (free, no key). Each pair is cached for a day, since the rates only change
 * once a working day. An expense keeps the rate it was logged with, so this is
 * only ever asked about new expenses.
 */
export const frankfurterRates = (redis: Redis, baseUrl: string): Rates => ({
  async quote(from, to) {
    if (from === to) return { from, to, rate: 1, date: new Date().toISOString().slice(0, 10) };
    const key = `fx:${from}:${to}`;
    const cached = await redis.get(key).catch(() => null);
    if (cached) return JSON.parse(cached) as FxQuote;

    const url = `${baseUrl}/latest?base=${encodeURIComponent(from)}&symbols=${encodeURIComponent(to)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (res.status === 404 || res.status === 422) return null;
    if (!res.ok) throw new Error(`Exchange rates answered ${res.status}`);
    const body = (await res.json()) as { date: string; rates: Record<string, number> };
    const rate = body.rates[to];
    if (!rate) return null;

    const quote: FxQuote = { from, to, rate, date: body.date };
    await redis.set(key, JSON.stringify(quote), 'EX', DAY_SEC).catch(() => undefined);
    return quote;
  },
});
