/**
 * Section 21–25, Stage D — per-merchant rate limits for the
 * pipeline fetch loop (audit §1 #17, §12 Stage D).
 *
 * THE GAP: the pipeline loop (`lib/workers/processors.ts`,
 * `price.refresh`) could call `provider.fetch` up to 100 times
 * with no delay and no backoff — one provider hammered in a
 * tight loop. eBay already has this discipline (10s timeout,
 * 3 attempts, 4,500/day budget in services/ebay-budget.ts); the
 * registry providers had none.
 *
 * THE FIX (same shape as eBay's budget discipline, per provider
 * key — eBay itself is excluded: it lives outside the registry
 * and its budget guard already applies):
 *   - a minimum interval between successive fetches to the SAME
 *     provider (default 1s; per-provider overrides below), so a
 *     100-product loop is paced, not a burst;
 *   - a per-minute burst cap per provider (default 60/min);
 *   - bounded retries with backoff for TRANSIENT fetch failures
 *     only (429 / 5xx / timeout / connection reset) — a
 *     non-transient failure (bad input, 401/403, unknown
 *     provider) is never retried.
 *
 * In-memory, per-instance state — the same limitation as the
 * rest of the in-process queue (see lib/workers/queue.ts): on a
 * multi-instance deploy each instance paces itself. The caps are
 * deliberately generous (a pacer, not a quota): the point is to
 * stop a tight loop, not to throttle a healthy refresh. Durable
 * cross-instance limits need Upstash (owner-gated) and are out
 * of scope here.
 */

export interface ProviderRateLimit {
  /** Minimum ms between two fetches to the same provider. */
  minIntervalMs: number;
  /** Max fetches to the same provider in a rolling 60s window. */
  maxCallsPerMinute: number;
}

export const DEFAULT_PROVIDER_RATE_LIMIT: ProviderRateLimit = {
  minIntervalMs: 1000,
  maxCallsPerMinute: 60,
};

/** Per-provider overrides (provider key → limit). CSV is the only
 *  registry provider that performs a real fetch today; the Amazon
 *  / Best Buy stubs return no data and Apify is fail-closed, so
 *  they keep the default. eBay is NOT listed: its budget guard
 *  (services/ebay-budget.ts) already paces it. */
export const PROVIDER_RATE_LIMITS: Record<string, ProviderRateLimit> = {
  csv: { minIntervalMs: 1000, maxCallsPerMinute: 60 },
};

export function getProviderRateLimit(providerKey: string): ProviderRateLimit {
  return PROVIDER_RATE_LIMITS[providerKey] ?? DEFAULT_PROVIDER_RATE_LIMIT;
}

/** Delays between transient-fetch retries (attempt 1 → 2 → 3). */
export const PROVIDER_FETCH_RETRY_DELAYS_MS = [1000, 2000] as const;
/** Total fetch attempts per source (first try + retries). */
export const PROVIDER_FETCH_MAX_ATTEMPTS = 3;

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * True when a provider-fetch failure is worth retrying: a
 * rate-limit / server error / timeout / connection failure.
 * Auth failures (401/403), bad input (400/404/422) and unknown
 * errors are NOT transient — retrying them burns budget for
 * nothing. Matches on the message because providers surface
 * failures as plain strings (see processors.ts).
 */
export function isTransientProviderError(error: unknown): boolean {
  const message = (
    error instanceof Error ? error.message : String(error ?? '')
  ).toLowerCase();
  if (
    message.includes('429') ||
    message.includes('rate limit') ||
    message.includes('rate-limit') ||
    message.includes('too many requests')
  ) {
    return true;
  }
  if (
    message.includes('500') ||
    message.includes('502') ||
    message.includes('503') ||
    message.includes('504') ||
    message.includes('server error') ||
    message.includes('bad gateway') ||
    message.includes('service unavailable')
  ) {
    return true;
  }
  if (
    message.includes('timeout') ||
    message.includes('timed out') ||
    message.includes('econnreset') ||
    message.includes('econnrefused') ||
    message.includes('socket hang up') ||
    message.includes('network error') ||
    message.includes('fetch failed')
  ) {
    return true;
  }
  return false;
}

interface ProviderSlotState {
  lastCallAtMs: number;
  /** Call timestamps (ms) inside the current rolling minute. */
  callsInWindow: number[];
}

/** Injectable clock/sleep so tests can drive the pacer without real waits. */
export interface ProviderRateLimitDeps {
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const slotState = new Map<string, ProviderSlotState>();

/** Test-only: drop all pacer state (fresh provider = no wait). */
export function resetProviderRateLimitState(): void {
  slotState.clear();
}

function stateFor(providerKey: string): ProviderSlotState {
  let state = slotState.get(providerKey);
  if (!state) {
    state = { lastCallAtMs: 0, callsInWindow: [] };
    slotState.set(providerKey, state);
  }
  return state;
}

/**
 * Wait until this provider may be fetched again, then record the
 * call. Returns the ms waited (0 on a first or well-spaced call).
 * The wait is the longer of (a) the minimum interval since the
 * last call to this provider and (b) the time until the oldest
 * call in the rolling minute window expires (burst cap).
 * Never throws: on any internal error it returns 0 and records
 * the call, so the pacer can never block a refresh.
 */
export async function acquireProviderFetchSlot(
  providerKey: string,
  deps: ProviderRateLimitDeps = {}
): Promise<{ waitedMs: number; providerKey: string }> {
  const nowFn = deps.now ?? Date.now;
  const sleepFn = deps.sleep ?? sleep;
  try {
    const limit = getProviderRateLimit(providerKey);
    const state = stateFor(providerKey);
    const now = nowFn();
    // Prune calls older than 60s from the burst window.
    state.callsInWindow = state.callsInWindow.filter((t) => now - t < 60_000);
    let waitMs = 0;
    if (state.lastCallAtMs > 0) {
      waitMs = Math.max(waitMs, state.lastCallAtMs + limit.minIntervalMs - now);
    }
    if (state.callsInWindow.length >= limit.maxCallsPerMinute) {
      const oldest = state.callsInWindow[0];
      waitMs = Math.max(waitMs, oldest + 60_000 - now);
    }
    if (waitMs > 0) {
      await sleepFn(waitMs);
    }
    const after = nowFn();
    state.lastCallAtMs = after;
    state.callsInWindow.push(after);
    return { waitedMs: waitMs, providerKey };
  } catch {
    return { waitedMs: 0, providerKey };
  }
}
