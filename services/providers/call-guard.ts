/**
 * Sections 21–25, Stage B (B3 + B6 + B12) — the one guarded path
 * for calling a registry provider.
 *
 * Before B6 only eBay was hardened; every other provider was
 * called bare — no timeout, no retry, no size cap, no budget, and
 * the circuit breaker (B3) was never consulted. All provider
 * calls from the queue processors now go through here:
 *
 *   1. Budget (B12): reserve one call from the provider's daily
 *      budget — fail-closed, never unlimited. Refused at the cap
 *      spends nothing and throws ProviderBudgetExhaustedError.
 *   2. Breaker (B3): when open, the call is SKIPPED — no provider
 *      is contacted — and ProviderCircuitOpenError is thrown so
 *      the caller records the skip honestly.
 *   3. Timeout: 10s per attempt (same shape as eBay's
 *      EBAY_FETCH_TIMEOUT_MS), via a race — providers take no
 *      AbortSignal, so a hung provider cannot hang the caller.
 *   4. Retry: up to 3 attempts for TRANSIENT failures (timeout /
 *      fetch errors). Config errors (NOT_CONFIGURED), budget and
 *      breaker errors are never retried. Backoff is 100ms ×
 *      attempt — small, because these are provider calls inside
 *      a refresh chain, not user-facing requests.
 *   5. Size cap: search results are sliced to
 *      PROVIDER_SEARCH_MAX_RESULTS (100); a provider returning
 *      more is truncated, never passed on whole.
 *
 * The guard never touches the network or the DB itself, and it
 * never swallows a provider error: after the last attempt the
 * original error is re-thrown. Health recording stays with the
 * caller (processors.ts), which knows the context.
 */

import { logger } from '@/lib/config/logger';
import { isProviderCircuitOpen, getProviderBreakerState } from '@/services/monitoring';
import { checkProviderBudget } from '@/services/provider-budget';
import {
  ProviderCircuitOpenError,
  isNonRetryableProviderError,
  type ProviderError,
} from './errors';
import type {
  DataProvider,
  ProviderFetchRequest,
  ProviderSearchRequest,
  RawProductData,
} from './types';

/** Same shape as eBay: 10s timeout, 3 attempts. */
export const PROVIDER_CALL_TIMEOUT_MS = 10_000;
export const PROVIDER_CALL_MAX_ATTEMPTS = 3;
/** Same shape as the pipeline batch cap: no search returns more than 100 rows. */
export const PROVIDER_SEARCH_MAX_RESULTS = 100;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** One attempt with a timeout race. A provider that never settles loses the race at 10s. */
async function withTimeout<T>(promise: Promise<T>, providerKey: string, op: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Provider call timed out after ${PROVIDER_CALL_TIMEOUT_MS}ms (${providerKey} ${op})`)),
          PROVIDER_CALL_TIMEOUT_MS
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

interface GuardOptions {
  /** Skip the budget reservation (tests that exercise the guard itself). Default: enforce. */
  skipBudget?: boolean;
  /** Skip the breaker check (tests that exercise the guard itself). Default: enforce. */
  skipBreaker?: boolean;
}

function guardPreCall(providerKey: string, options: GuardOptions): void {
  // Budget first: a refused call must not touch the breaker or the provider.
  if (!options.skipBudget) checkProviderBudget(providerKey);
  if (!options.skipBreaker && isProviderCircuitOpen(providerKey)) {
    const state = getProviderBreakerState(providerKey);
    throw new ProviderCircuitOpenError(providerKey, state.consecutiveFailures);
  }
}

async function runWithRetries<T>(
  providerKey: string,
  op: 'search' | 'fetch',
  attemptFn: () => Promise<T>
): Promise<T> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= PROVIDER_CALL_MAX_ATTEMPTS; attempt++) {
    try {
      return await withTimeout(attemptFn(), providerKey, op);
    } catch (err) {
      lastError = err;
      // Never retry config / budget / breaker errors: retrying a
      // missing client or a spent budget cannot succeed.
      if (isNonRetryableProviderError(err)) throw err;
      if (attempt === PROVIDER_CALL_MAX_ATTEMPTS) throw err;
      logger.warn('provider call failed — retrying', {
        provider: providerKey,
        op,
        attempt,
        error: String(err),
      });
      await sleep(100 * attempt);
    }
  }
  // Unreachable (the loop always returns or throws), but tsc needs it.
  throw lastError as ProviderError;
}

/** Guarded provider.search — budget + breaker + 10s timeout + 3 attempts + 100-row cap. */
export async function callProviderSearch(
  provider: DataProvider,
  request: ProviderSearchRequest,
  options: GuardOptions = {}
): Promise<RawProductData[]> {
  guardPreCall(provider.key, options);
  const results = await runWithRetries(provider.key, 'search', () =>
    provider.search({
      ...request,
      limit:
        typeof request.limit === 'number' && request.limit > 0
          ? Math.min(request.limit, PROVIDER_SEARCH_MAX_RESULTS)
          : PROVIDER_SEARCH_MAX_RESULTS,
    })
  );
  return results.slice(0, PROVIDER_SEARCH_MAX_RESULTS);
}

/** Guarded provider.fetch — budget + breaker + 10s timeout + 3 attempts. */
export async function callProviderFetch(
  provider: DataProvider,
  request: ProviderFetchRequest,
  options: GuardOptions = {}
): Promise<RawProductData | null> {
  guardPreCall(provider.key, options);
  return runWithRetries(provider.key, 'fetch', () => provider.fetch(request));
}
