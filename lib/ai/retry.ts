// ---------------------------------------------------------------------------
// Retry with exponential backoff for Anthropic rate-limit (429) errors.
// Also provides a concurrency limiter to avoid blowing through TPM limits.
//
// Matches the monitoring agent's utils/retry.py:
//   - Rate limit errors: 15s × (attempt + 1) — deliberate long backoff
//   - Other errors: exponential backoff (1s, 2s, 4s)
// ---------------------------------------------------------------------------

/**
 * Retry an async function on 429 / rate-limit errors with backoff.
 * Rate limit errors get a longer 15s-based backoff matching the monitoring agent.
 * Non-rate-limit errors are thrown immediately.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  { maxRetries = 3, backoffBase = 1_000 } = {},
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      if (attempt >= maxRetries || !isRetriableError(err)) throw err;

      // Rate limit errors get 15s × (attempt + 1) — matches monitoring agent exactly
      const delay = isRateLimitError(err)
        ? 15_000 * (attempt + 1)
        : backoffBase * 2 ** attempt;

      console.warn(
        `[retry] Attempt ${attempt + 1}/${maxRetries}, waiting ${(delay / 1000).toFixed(0)}s: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      await sleep(delay);
    }
  }
}

/**
 * Run async tasks with bounded concurrency.
 * Like Promise.all but limits how many tasks execute simultaneously.
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;

  async function worker() {
    while (next < items.length) {
      const idx = next++;
      results[idx] = await fn(items[idx]);
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => worker(),
  );
  await Promise.all(workers);
  return results;
}

function isRateLimitError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const msg = ('message' in err && typeof err.message === 'string') ? err.message : '';
  if (msg.includes('rate limit') || msg.includes('429') || msg.includes('Too Many Requests')) {
    return true;
  }
  if ('status' in err && (err as { status: number }).status === 429) return true;
  if ('statusCode' in err && (err as { statusCode: number }).statusCode === 429) return true;
  if ('cause' in err) return isRateLimitError((err as { cause: unknown }).cause);
  return false;
}

function isRetriableError(err: unknown): boolean {
  if (isRateLimitError(err)) return true;
  if (!err || typeof err !== 'object') return false;
  const msg = ('message' in err && typeof err.message === 'string') ? err.message : '';
  // Also retry on connection/timeout/5xx errors (matches monitoring agent's RETRIABLE_EXCEPTIONS)
  if (msg.includes('ECONNREFUSED') || msg.includes('ETIMEDOUT') || msg.includes('ENOTFOUND')) return true;
  if (msg.includes('Internal Server Error') || msg.includes('overloaded')) return true;
  if ('status' in err) {
    const status = (err as { status: number }).status;
    if (status >= 500 && status < 600) return true;
  }
  if ('statusCode' in err) {
    const code = (err as { statusCode: number }).statusCode;
    if (code >= 500 && code < 600) return true;
  }
  if ('cause' in err) return isRetriableError((err as { cause: unknown }).cause);
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
