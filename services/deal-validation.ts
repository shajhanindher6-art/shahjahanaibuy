/**
 * Deal discount validation + deal-identity dedupe (Section 19,
 * Phase 2 — §12 #23, #58, #60, #66).
 *
 * Until Section 19, deal ranking trusted the claimed discount
 * with zero history input: aiScore was built from the merchant's
 * stated percentage, and the `is_featured` flag fired on that
 * score alone. The fake-sale / inflation detectors existed but
 * had no caller anywhere in the deals pipeline. This module wires
 * them in:
 *
 * - validateDealDiscount runs checkPriceInflation (which itself
 *   runs detectFakeSale) over the product's recorded price
 *   history. A deal is `validated` only when there is enough
 *   history (≥2 points) AND no fake-discount / inflation pattern.
 *   Anything else is `flagged` (pattern found) or `insufficient`
 *   (too little history to judge — absence of evidence is not a
 *   pass). The 90-day lowest is reported as supporting evidence,
 *   never as a gate: a real discount that does not beat the
 *   90-day low is still a real discount.
 * - The `is_featured` gate (in services/ai-deals.ts) requires
 *   status `validated`: no featured flag without price evidence.
 * - dedupeByKey collapses identical deals (same product +
 *   merchant + discount + window) to one row, so two identical
 *   active deals never rank as two rows even before migration
 *   054's UNIQUE index is applied (owner-gated).
 *
 * PURE except fetchDealHistoryByProduct (one getPriceHistory call
 * per product). No scraping, no invented prices: every number in
 * the reason comes from recorded history.
 */

import type { AnySupabaseClient } from '@/lib/supabase/types';
import { checkPriceInflation } from './inflation-check';
import { deriveLowest90d } from './ninety-day';
import type { FakeSalePoint } from './fake-sale';
import { getPriceHistory } from './price-history';

export type DealDiscountValidationStatus = 'validated' | 'flagged' | 'insufficient';

export interface DealDiscountValidation {
  status: DealDiscountValidationStatus;
  /** Human reason, always tied to the real recorded numbers. */
  reason: string;
  /** Recorded history points the check ran over. */
  historyPoints: number;
  /** Inflation-check verdict, or null when there was too little history to run it. */
  inflationVerdict: 'fake_discount_pattern' | 'inflated' | 'no_pattern' | 'insufficient' | null;
  /** Lowest price of the last 90 days, or null when the 90-day history is not ready. */
  lowest90d: number | null;
  /** True when the recorded history covers a full 90 days. */
  lowest90dReady: boolean;
  /** Price after applying the claimed discount to the current recorded price, or null. */
  effectivePrice: number | null;
}

/** Minimum recorded points for a discount to be validated at all. */
export const DEAL_VALIDATION_MIN_POINTS = 2;

function money(n: number): string {
  return `$${n.toFixed(2)}`;
}

/**
 * Validate a deal's claimed discount against recorded price
 * history. The claimed discount is described by its type/value
 * plus the current recorded price; the effective (post-discount)
 * price is derived from those real numbers, never guessed.
 */
export function validateDealDiscount(input: {
  /** Recorded price points, any order (detectors sort internally). */
  history: FakeSalePoint[];
  /** Latest recorded price, or null when none is recorded. */
  currentPrice: number | null;
  /** 'percentage' | 'fixed' (other types: no derivable effective price). */
  discountType: string;
  /** Claimed discount: % for percentage deals, $ for fixed deals. */
  discountValue: number;
}): DealDiscountValidation {
  const { history, currentPrice, discountType, discountValue } = input;
  const points = history.length;

  const base = {
    historyPoints: points,
    inflationVerdict: null as DealDiscountValidation['inflationVerdict'],
    lowest90d: null as number | null,
    lowest90dReady: false,
    effectivePrice: null as number | null,
  };

  if (points < DEAL_VALIDATION_MIN_POINTS) {
    return {
      ...base,
      status: 'insufficient',
      reason:
        `Only ${points} recorded price point${points === 1 ? '' : 's'} — ` +
        'not enough history to validate the claimed discount.',
    };
  }

  const inflation = checkPriceInflation(history);
  const lowest90dResult = deriveLowest90d(history);

  let effectivePrice: number | null = null;
  if (currentPrice !== null && Number.isFinite(currentPrice) && currentPrice > 0) {
    if (discountType === 'percentage' && Number.isFinite(discountValue)) {
      effectivePrice = Math.round(currentPrice * (1 - discountValue / 100) * 100) / 100;
    } else if (discountType === 'fixed' && Number.isFinite(discountValue)) {
      effectivePrice = Math.round((currentPrice - discountValue) * 100) / 100;
    }
  }

  const shared = {
    ...base,
    inflationVerdict: inflation.verdict,
    lowest90d: lowest90dResult.lowest,
    lowest90dReady: lowest90dResult.status === 'ready',
    effectivePrice,
  };

  // Fewer than 2 points inside the 30-day window means the
  // pattern check could not run at all — the discount cannot be
  // validated, and "no pattern" must never be claimed from a
  // check that never ran.
  if (inflation.verdict === 'insufficient') {
    return { ...shared, status: 'insufficient', reason: inflation.reason };
  }

  // A detected pattern fails validation outright — the claimed
  // discount is measured against a raised price, not a real one.
  if (inflation.verdict === 'fake_discount_pattern' || inflation.verdict === 'inflated') {
    return { ...shared, status: 'flagged', reason: inflation.reason };
  }

  // No pattern: the discount is validated, with the 90-day lowest
  // reported as supporting evidence (never a second gate). The
  // count is the points actually inside the 30-day window the
  // check ran over — not the whole history.
  let reason =
    `No fake-discount or inflation pattern in the last 30 days ` +
    `across ${inflation.pointCount} recorded price${inflation.pointCount === 1 ? '' : 's'}.`;
  if (effectivePrice !== null && lowest90dResult.status === 'ready' && lowest90dResult.lowest !== null) {
    reason +=
      effectivePrice <= lowest90dResult.lowest
        ? ` The discounted price (${money(effectivePrice)}) is at or below the lowest recorded in the last 90 days (${money(lowest90dResult.lowest)}).`
        : ` The discounted price (${money(effectivePrice)}) is still above the lowest recorded in the last 90 days (${money(lowest90dResult.lowest)}) — the deal does not beat the best recorded price.`;
  } else if (effectivePrice !== null && lowest90dResult.lowest === null) {
    reason += ' 90-day lowest not yet available — recorded history covers less than 90 days.';
  }
  return { ...shared, status: 'validated', reason };
}

/**
 * Fetch each product's recorded price history (oldest first) in
 * parallel — one getPriceHistory call per product. Products with
 * no history map to an empty series (validation then reports
 * `insufficient`, never a pass).
 */
export async function fetchDealHistoryByProduct(
  supabase: AnySupabaseClient,
  productIds: string[]
): Promise<Map<string, { points: FakeSalePoint[]; lowest: number | null }>> {
  const ids = Array.from(new Set(productIds.filter(Boolean)));
  const out = new Map<string, { points: FakeSalePoint[]; lowest: number | null }>();
  if (ids.length === 0) return out;
  const results = await Promise.all(
    ids.map(async (id) => {
      const { history, lowestPrice } = await getPriceHistory(supabase, id, { limit: 100 });
      return {
        id,
        points: [...history]
          .sort(
            (a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime()
          )
          .map((h) => ({ price: h.price, recordedAt: h.recordedAt })),
        lowest: lowestPrice,
      };
    })
  );
  for (const r of results) out.set(r.id, { points: r.points, lowest: r.lowest });
  return out;
}

/**
 * Collapse identical rows to one (first occurrence wins),
 * keyed by the caller's identity function. Used for §12 #66:
 * two identical active deals (same product + merchant +
 * discount + window) must not rank as two rows.
 */
export function dedupeByKey<T>(rows: T[], keyOf: (row: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const row of rows) {
    const key = keyOf(row);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

/**
 * Deal identity for dedupe: product + merchant + discount +
 * window — the same columns migration 054 constrains with a
 * UNIQUE index. A null merchant is the empty string (the
 * migration's COALESCE equivalent), so two merchant-less
 * identical deals still collapse in code.
 */
export function dealIdentityKey(input: {
  productId: string | null;
  merchantId: string | null;
  discountType: string;
  discountValue: number;
  startAt: string;
  endAt: string;
}): string {
  return [
    input.productId ?? '',
    input.merchantId ?? '',
    input.discountType,
    String(input.discountValue),
    input.startAt,
    input.endAt,
  ].join('|');
}

// ---------------------------------------------------------------------------
// Coupon history cross-check (Section 19, Phase 2 §12 #22).
// ---------------------------------------------------------------------------

export type CouponDiscountEvidenceStatus = 'supported' | 'unsupported' | 'insufficient';

export interface CouponDiscountEvidence {
  status: CouponDiscountEvidenceStatus;
  /** Human reason, always tied to the real recorded numbers. */
  reason: string;
  /** Price after applying the claimed discount to the current recorded price, or null. */
  effectivePrice: number | null;
  /** Lowest price of the last 90 days, or null when the 90-day history is not ready. */
  lowest90d: number | null;
}

/**
 * Cross-check a coupon's claimed discount against recorded price
 * history. The check answers one question: does the code actually
 * get the shopper below the best price already recorded?
 * - <2 history points → `insufficient` (cannot judge).
 * - No current recorded price → `insufficient` (never a guess).
 * - A fake-discount / inflation pattern in the history →
 *   `unsupported` (the "discount" is measured against a raised price).
 * - Effective price at/below the 90-day lowest (or, while the
 *   90-day history is still pending, at/below the lowest recorded
 *   price) → `supported`.
 * - Effective price still above that lowest → `unsupported`, with
 *   the numbers stated — the code is real, it just does not beat
 *   the best recorded price.
 * This says nothing about whether the code works at the merchant
 * checkout — that is owner-gated (merchant feeds) and labelled
 * separately (COUPON_CHECKOUT_UNVERIFIED_LABEL in lib/deal-math).
 */
export function checkCouponDiscountAgainstHistory(
  coupon: { discountType: string; discountValue: number },
  history: FakeSalePoint[],
  currentPrice: number | null
): CouponDiscountEvidence {
  const base = {
    effectivePrice: null as number | null,
    lowest90d: null as number | null,
  };
  if (history.length < 2) {
    return {
      ...base,
      status: 'insufficient',
      reason: `Only ${history.length} recorded price point${history.length === 1 ? '' : 's'} — not enough history to check this code's claimed discount.`,
    };
  }
  if (currentPrice === null || !Number.isFinite(currentPrice) || currentPrice <= 0) {
    return {
      ...base,
      status: 'insufficient',
      reason: 'No current recorded price — the claimed discount cannot be checked against price history.',
    };
  }

  const inflation = checkPriceInflation(history);
  // Fewer than 2 points inside the 30-day window: the pattern
  // check could not run — the code cannot be validated, and "no
  // pattern" must never be claimed from a check that never ran.
  if (inflation.verdict === 'insufficient') {
    return { ...base, status: 'insufficient', reason: inflation.reason };
  }
  if (inflation.verdict === 'fake_discount_pattern' || inflation.verdict === 'inflated') {
    return { ...base, status: 'unsupported', reason: inflation.reason };
  }

  let effectivePrice: number | null = null;
  if (coupon.discountType === 'percentage' && Number.isFinite(coupon.discountValue)) {
    effectivePrice = Math.round(currentPrice * (1 - coupon.discountValue / 100) * 100) / 100;
  } else if (coupon.discountType === 'fixed' && Number.isFinite(coupon.discountValue)) {
    effectivePrice = Math.round((currentPrice - coupon.discountValue) * 100) / 100;
  }
  if (effectivePrice === null) {
    return {
      ...base,
      status: 'insufficient',
      reason: 'The claimed discount type has no derivable effective price — it cannot be checked against price history.',
    };
  }

  const lowest90dResult = deriveLowest90d(history);
  const lowest = lowest90dResult.status === 'ready' ? lowest90dResult.lowest : null;
  const recordedLowest = Math.min(...history.map((p) => p.price));
  const compareLow = lowest ?? recordedLowest;
  const windowLabel =
    lowest90dResult.status === 'ready'
      ? 'the lowest recorded in the last 90 days'
      : 'the lowest recorded price';
  if (effectivePrice <= compareLow) {
    return {
      effectivePrice,
      lowest90d: lowest,
      status: 'supported',
      reason:
        `With this code the price would be ${money(effectivePrice)}, at or below ` +
        `${windowLabel} (${money(compareLow)}).`,
    };
  }
  return {
    effectivePrice,
    lowest90d: lowest,
    status: 'unsupported',
    reason:
      `Even with this code the price would be ${money(effectivePrice)}, still above ` +
      `${windowLabel} (${money(compareLow)}) — the claimed discount has no supporting history.`,
  };
}
