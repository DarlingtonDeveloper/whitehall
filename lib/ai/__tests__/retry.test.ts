import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { withRetry, mapWithConcurrency } from '../retry';

// Suppress console.warn during tests
beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// Helper: run withRetry while advancing fake timers so sleeps resolve instantly
async function runWithAdvancingTimers<T>(promise: Promise<T>): Promise<T> {
  // Flush all pending timers repeatedly until the promise settles
  let settled = false;
  let result: T;
  let error: unknown;

  const p = promise.then(
    (r) => { settled = true; result = r; },
    (e) => { settled = true; error = e; },
  );

  while (!settled) {
    await vi.advanceTimersByTimeAsync(20_000);
  }

  await p;
  if (error !== undefined) throw error;
  return result!;
}

// ---------------------------------------------------------------------------
// withRetry
// ---------------------------------------------------------------------------

describe('withRetry', () => {
  it('returns result on first success', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await runWithAdvancingTimers(
      withRetry(fn, { maxRetries: 3, backoffBase: 1 }),
    );
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on retriable errors', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValue('ok');

    const result = await runWithAdvancingTimers(
      withRetry(fn, { maxRetries: 3, backoffBase: 1 }),
    );
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('throws non-retriable errors immediately', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('Invalid argument'));
    await expect(
      runWithAdvancingTimers(withRetry(fn, { maxRetries: 3, backoffBase: 1 })),
    ).rejects.toThrow('Invalid argument');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('throws after exhausting retries', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(
      runWithAdvancingTimers(withRetry(fn, { maxRetries: 2, backoffBase: 1 })),
    ).rejects.toThrow('ECONNREFUSED');
    expect(fn).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it('retries on 429 status errors', async () => {
    const err = Object.assign(new Error('rate limit'), { status: 429 });
    const fn = vi
      .fn()
      .mockRejectedValueOnce(err)
      .mockResolvedValue('ok');

    const result = await runWithAdvancingTimers(
      withRetry(fn, { maxRetries: 3, backoffBase: 1 }),
    );
    expect(result).toBe('ok');
  });

  it('retries on 500 status errors', async () => {
    const err = Object.assign(new Error('Internal Server Error'), { status: 500 });
    const fn = vi
      .fn()
      .mockRejectedValueOnce(err)
      .mockResolvedValue('ok');

    const result = await runWithAdvancingTimers(
      withRetry(fn, { maxRetries: 3, backoffBase: 1 }),
    );
    expect(result).toBe('ok');
  });

  it('retries on overloaded message', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('Service overloaded'))
      .mockResolvedValue('ok');

    const result = await runWithAdvancingTimers(
      withRetry(fn, { maxRetries: 3, backoffBase: 1 }),
    );
    expect(result).toBe('ok');
  });

  it('retries on ETIMEDOUT', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('ETIMEDOUT'))
      .mockResolvedValue('ok');

    const result = await runWithAdvancingTimers(
      withRetry(fn, { maxRetries: 3, backoffBase: 1 }),
    );
    expect(result).toBe('ok');
  });

  it('retries on statusCode 429', async () => {
    const err = Object.assign(new Error('Too Many Requests'), { statusCode: 429 });
    const fn = vi
      .fn()
      .mockRejectedValueOnce(err)
      .mockResolvedValue('ok');

    const result = await runWithAdvancingTimers(
      withRetry(fn, { maxRetries: 3, backoffBase: 1 }),
    );
    expect(result).toBe('ok');
  });

  it('retries on nested cause with rate limit', async () => {
    const inner = Object.assign(new Error('rate limit'), { status: 429 });
    const outer = Object.assign(new Error('Wrapped'), { cause: inner });
    const fn = vi
      .fn()
      .mockRejectedValueOnce(outer)
      .mockResolvedValue('ok');

    const result = await runWithAdvancingTimers(
      withRetry(fn, { maxRetries: 3, backoffBase: 1 }),
    );
    expect(result).toBe('ok');
  });
});

// ---------------------------------------------------------------------------
// mapWithConcurrency
// ---------------------------------------------------------------------------

describe('mapWithConcurrency', () => {
  it('processes all items', async () => {
    vi.useRealTimers();
    const items = [1, 2, 3, 4, 5];
    const results = await mapWithConcurrency(items, 2, async (n) => n * 2);
    expect(results).toEqual([2, 4, 6, 8, 10]);
  });

  it('preserves order', async () => {
    vi.useRealTimers();
    const items = ['a', 'b', 'c'];
    const results = await mapWithConcurrency(items, 1, async (s) => s.toUpperCase());
    expect(results).toEqual(['A', 'B', 'C']);
  });

  it('handles empty array', async () => {
    vi.useRealTimers();
    const results = await mapWithConcurrency([], 5, async (n: number) => n);
    expect(results).toEqual([]);
  });

  it('respects concurrency limit', async () => {
    vi.useRealTimers();
    let maxConcurrent = 0;
    let currentConcurrent = 0;

    const items = [1, 2, 3, 4, 5, 6];
    await mapWithConcurrency(items, 2, async () => {
      currentConcurrent++;
      maxConcurrent = Math.max(maxConcurrent, currentConcurrent);
      await new Promise((r) => setTimeout(r, 10));
      currentConcurrent--;
    });

    expect(maxConcurrent).toBeLessThanOrEqual(2);
  });

  it('propagates errors', async () => {
    vi.useRealTimers();
    const items = [1, 2, 3];
    await expect(
      mapWithConcurrency(items, 2, async (n) => {
        if (n === 2) throw new Error('fail');
        return n;
      }),
    ).rejects.toThrow('fail');
  });

  it('handles single item', async () => {
    vi.useRealTimers();
    const results = await mapWithConcurrency([42], 5, async (n) => n + 1);
    expect(results).toEqual([43]);
  });

  it('handles concurrency larger than array', async () => {
    vi.useRealTimers();
    const items = [1, 2];
    const results = await mapWithConcurrency(items, 100, async (n) => n * 10);
    expect(results).toEqual([10, 20]);
  });
});
