import { afterEach, describe, expect, it, vi } from 'vitest';
import { startKeepAwake } from '../src/lib/keep-awake';

describe('keep-awake ping', () => {
  afterEach(() => vi.useRealTimers());

  it("asks its own public /health on a timer, so Render doesn't put it to sleep", async () => {
    vi.useFakeTimers();
    const urls: string[] = [];
    const fetchImpl = (async (url: string) => {
      urls.push(url);
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    const stop = startKeepAwake('https://tagalong-api.onrender.com/', { warn: () => {} }, { everyMs: 1000, fetchImpl });

    await vi.advanceTimersByTimeAsync(3500);
    expect(urls).toEqual(Array(3).fill('https://tagalong-api.onrender.com/health'));
    stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(urls).toHaveLength(3);
  });

  it('does nothing off Render, where there is no public address', () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    startKeepAwake(undefined, { warn: () => {} }, { everyMs: 10, fetchImpl })();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('logs a failed ping instead of crashing', async () => {
    vi.useFakeTimers();
    const warn = vi.fn();
    const fetchImpl = (async () => {
      throw new Error('ECONNRESET');
    }) as unknown as typeof fetch;
    const stop = startKeepAwake('https://x.onrender.com', { warn }, { everyMs: 1000, fetchImpl });
    await vi.advanceTimersByTimeAsync(1100);
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({ err: expect.stringContaining('ECONNRESET') }), 'Keep-awake ping failed');
    stop();
  });
});
