/**
 * Section 19, Phase 1 (§12 #6) — shared retry with backoff for AI providers.
 *
 * Honours the `retryable` flag the audit found no caller honouring
 * (§1 #55: HF 503 → the user had to retry manually). A failure is
 * retried only when it is retryable; anything else throws on the
 * first attempt. Backoff is exponential (base × 2^attempt) with a
 * small default so the worst case (3 attempts) adds ~600 ms.
 *
 * This helper retries the CALL; the circuit breaker lives in
 * usage.ts (`isAiCircuitOpen`, same 5-consecutive-failure threshold
 * as the durable circuit in `services/monitoring.ts`) and is
 * consulted by the engine BEFORE a provider is tried, so a
 * provider that is already down is not retried into at all.
 */

export interface RetryOptions<T> {
  /** Total attempts including the first (default 3). */
  maxAttempts?: number;
  /** Base delay in ms before the first retry (default 200). Doubled per attempt. */
  baseDelayMs?: number;
  /**
   * Extra retryability test for thrown errors. The default
   * (`isRetryableError`) covers the `retryable` flag, HTTP
   * 429/5xx, and network/timeout failures.
   */
  isRetryable?: (error: unknown) => boolean;
  /**
   * When set, a SUCCESSFUL result that satisfies this predicate is
   * treated as retryable (e.g. an HTTP Response with a 503/429
   * status — the fetch itself did not throw). The retried call
   * re-runs `fn` from scratch.
   */
  shouldRetryResult?: (result: T) => boolean;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * True when an error is worth retrying: an explicit
 * `retryable: true` flag (the HfResult convention), an HTTP
 * 429/502/503/504 status carried on the error, or a network /
 * timeout failure (fetch failed, aborted, reset, timed out).
 * 401/403/400 and validation errors are never retryable.
 */
export function isRetryableError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const err = error as Record<string, unknown>;
  if (err.retryable === true) return true;
  if (err.retryable === false) return false;
  const status =
    typeof err.status === 'number'
      ? err.status
      : typeof (err as { statusCode?: unknown }).statusCode === 'number'
        ? (err as { statusCode: number }).statusCode
        : null;
  if (status === 429 || status === 502 || status === 503 || status === 504) return true;
  const name = typeof err.name === 'string' ? err.name : '';
  if (name === 'AbortError' || name === 'TimeoutError') return true;
  const message = typeof err.message === 'string' ? err.message : '';
  if (/fetch failed|ECONNRESET|ETIMEDOUT|EAI_AGAIN|network|timed out/i.test(message)) return true;
  return false;
}

/** True when an HTTP response status is worth retrying (429 / 5xx). */
export function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

export async function withAiRetry<T>(fn: () => Promise<T>, options: RetryOptions<T> = {}): Promise<T> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 3);
  const baseDelayMs = Math.max(0, options.baseDelayMs ?? 200);
  const isRetryable = options.isRetryable ?? isRetryableError;

  let lastError: unknown = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await fn();
      if (options.shouldRetryResult && options.shouldRetryResult(result) && attempt < maxAttempts) {
        await sleep(baseDelayMs * 2 ** (attempt - 1));
        continue;
      }
      return result;
    } catch (err) {
      lastError = err;
      if (!isRetryable(err) || attempt >= maxAttempts) throw err;
      await sleep(baseDelayMs * 2 ** (attempt - 1));
    }
  }
  // Unreachable (the loop always returns or throws), but kept for the type checker.
  throw lastError;
}
