/**
 * Sections 21–25, Stage B (B1) — typed provider errors.
 *
 * Provider stubs used to fail SILENTLY: `search()` returned `[]` and
 * `fetch()` returned `null`, which every caller reads as "no results"
 * — indistinguishable from a healthy provider that genuinely found
 * nothing. A stub that looks working is worse than a missing one.
 * From here on, a provider that cannot fetch THROWS one of these
 * typed errors (or returns it through the call guard), naming the
 * provider and the reason. Callers that must stay up (the refresh
 * chain, the queue processors) catch them and record the failure
 * honestly — they never convert them back into an empty success.
 */

export type ProviderErrorCode =
  | 'PROVIDER_NOT_CONFIGURED'
  | 'PROVIDER_FETCH_FAILED'
  | 'PROVIDER_BUDGET_EXHAUSTED'
  | 'PROVIDER_CIRCUIT_OPEN';

/** Base class: every provider error carries its code + provider key. */
export class ProviderError extends Error {
  readonly code: ProviderErrorCode;
  readonly providerKey: string;
  /** Plain-language reason, safe to show to an admin (never a secret). */
  readonly reason: string;

  constructor(code: ProviderErrorCode, providerKey: string, reason: string) {
    super(`[${providerKey}] ${reason}`);
    this.name = 'ProviderError';
    this.code = code;
    this.providerKey = providerKey;
    this.reason = reason;
  }
}

/**
 * The provider has no live client / no usable configuration.
 * Thrown by stubs (Amazon, Best Buy — no client exists yet) and by
 * unconfigured providers (CSV with no source, Apify with no vars).
 * Never retried: retrying a missing client cannot succeed.
 */
export class ProviderNotConfiguredError extends ProviderError {
  constructor(providerKey: string, reason: string) {
    super('PROVIDER_NOT_CONFIGURED', providerKey, reason);
    this.name = 'ProviderNotConfiguredError';
  }
}

/** A configured provider's fetch/search failed (network, HTTP, SSRF refusal, oversize). */
export class ProviderFetchError extends ProviderError {
  constructor(providerKey: string, reason: string) {
    super('PROVIDER_FETCH_FAILED', providerKey, reason);
    this.name = 'ProviderFetchError';
  }
}

/** The provider's daily call budget is spent (B12). Never retried today. */
export class ProviderBudgetExhaustedError extends ProviderError {
  readonly limit: number;
  readonly used: number;

  constructor(providerKey: string, limit: number, used: number) {
    super(
      'PROVIDER_BUDGET_EXHAUSTED',
      providerKey,
      `Daily call budget exhausted for ${providerKey}: ${used} of ${limit} calls used today — try tomorrow.`
    );
    this.name = 'ProviderBudgetExhaustedError';
    this.limit = limit;
    this.used = used;
  }
}

/** The circuit breaker is open for this provider (B3): the call was skipped, not attempted. */
export class ProviderCircuitOpenError extends ProviderError {
  constructor(providerKey: string, consecutiveFailures: number) {
    super(
      'PROVIDER_CIRCUIT_OPEN',
      providerKey,
      `Circuit breaker open for ${providerKey} after ${consecutiveFailures} consecutive failures — call skipped, no provider was contacted.`
    );
    this.name = 'ProviderCircuitOpenError';
  }
}

export function isProviderError(error: unknown): error is ProviderError {
  return error instanceof ProviderError;
}

/** True for errors that must never be retried (config + budget + breaker). */
export function isNonRetryableProviderError(error: unknown): boolean {
  return (
    error instanceof ProviderNotConfiguredError ||
    error instanceof ProviderBudgetExhaustedError ||
    error instanceof ProviderCircuitOpenError
  );
}
