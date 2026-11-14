/**
 * AI Negotiation Coach — param parsing (T6, /tools/negotiation-coach).
 *
 * Small wrapper around services/negotiation.ts: the page is a
 * server component with a plain GET form (?product=…&target=…
 * &reason=…), so the query string needs parsing + validation
 * before the engine runs. The gap math and the message draft
 * themselves live in services/negotiation.ts and are NOT
 * duplicated here.
 *
 * HONESTY: a target must be a finite number above $0 — anything
 * else returns an error, never a fabricated analysis. The reason
 * is the user's own words, trimmed and capped; it is never
 * invented when absent.
 */

export const NEGOTIATION_COACH_MAX_REASON_LENGTH = 500;

export interface NegotiationCoachParams {
  /** Catalog slug from ?product=. */
  productSlug: string | null;
  /** User's target price in USD, or null when absent/invalid. */
  targetUsd: number | null;
  /** Optional reason, the user's own words. */
  reason: string | null;
  /** Human-readable validation error, or null when the params
   *  are usable (or absent — no query yet is not an error). */
  error: string | null;
}

function firstParam(value: string | string[] | undefined): string | null {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return null;
}

/**
 * Parse the GET form's params. `target` is required for an
 * analysis; a product slug is required to pick the product.
 * Either missing on its own is "no query yet" (error null,
 * value null) — the page shows the form. A present-but-invalid
 * target is an error the page reports.
 */
export function parseNegotiationCoachParams(searchParams: {
  product?: string | string[];
  target?: string | string[];
  reason?: string | string[];
}): NegotiationCoachParams {
  const productSlug = firstParam(searchParams.product)?.trim() || null;
  const rawTarget = firstParam(searchParams.target);
  const rawReason = firstParam(searchParams.reason);
  const reason =
    rawReason !== null && rawReason.trim() !== ''
      ? rawReason.trim().slice(0, NEGOTIATION_COACH_MAX_REASON_LENGTH)
      : null;

  if (rawTarget === null || rawTarget.trim() === '') {
    return { productSlug, targetUsd: null, reason, error: null };
  }
  const targetUsd = Number(rawTarget);
  if (!Number.isFinite(targetUsd) || targetUsd <= 0) {
    return {
      productSlug,
      targetUsd: null,
      reason,
      error: 'Enter a target price above $0 to see the gap analysis.',
    };
  }
  return { productSlug, targetUsd, reason, error: null };
}
