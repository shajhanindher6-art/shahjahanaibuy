/**
 * Deal Checker — pure helpers for /tools/deal-checker
 * (Section 14, Chunk 2).
 *
 * The user enters a product and a price they found somewhere
 * ("a deal they found"); the checker judges it ONLY against the
 * RECORDED price history (currently 4 points per product over
 * 30 days, Amazon only) and the current recorded price.
 *
 * Honesty rules:
 * - Deterministic, no invented data: the verdict comes only from
 *   recorded points. No Deal Score, no forecast, no probability —
 *   the Deal Score is 100/100 for every product today, so nothing
 *   here claims one deal is "hotter" than another.
 * - 'real-deal' means strictly below the lowest RECORDED price —
 *   a price never seen in the recorded history. 'below-current'
 *   means cheaper than the current recorded price but not below
 *   the recorded low. 'not-a-deal' means at or above the current
 *   recorded price. 'cannot-verify' means the product has no
 *   recorded history to compare against — the found price is
 *   reported back without a verdict.
 * - The checker never sees the store the price came from, so it
 *   cannot verify shipping, taxes, condition, or whether the
 *   listing is genuine.
 */

import {
  computeTrendStats,
  type TrendPoint,
} from '@/lib/price-trend';

export type DealVerdict =
  | 'real-deal'
  | 'below-current'
  | 'not-a-deal'
  | 'cannot-verify';

export const DEAL_VERDICT_LABELS: Record<DealVerdict, string> = {
  'real-deal': 'Real deal — below every recorded price',
  'below-current': 'Cheaper than the current recorded price',
  'not-a-deal': 'Not a deal — at or above the current recorded price',
  'cannot-verify': 'Cannot verify — no recorded price history',
};

export interface DealCheck {
  foundPrice: number;
  current: number;
  lowest: number;
  highest: number;
  pointCount: number;
  /** Current recorded price minus found price (negative when above current). */
  savingVsCurrent: number;
  /** Lowest recorded price minus found price (negative when above the low). */
  savingVsLowest: number;
  verdict: DealVerdict;
}

/**
 * Check `foundPrice` against recorded points. Returns null for a
 * non-positive found price. With no recorded history the result
 * carries verdict 'cannot-verify' and NaN price fields.
 */
export function checkDeal(
  foundPrice: number,
  points: TrendPoint[]
): DealCheck | null {
  if (!Number.isFinite(foundPrice) || foundPrice <= 0) return null;
  const stats = computeTrendStats(
    [...points]
      .filter(
        (p) =>
          Number.isFinite(p.price) &&
          p.recordedAt &&
          Number.isFinite(new Date(p.recordedAt).getTime())
      )
      .sort(
        (a, b) =>
          new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime()
      )
  );
  if (stats === null) {
    return {
      foundPrice,
      current: NaN,
      lowest: NaN,
      highest: NaN,
      pointCount: 0,
      savingVsCurrent: NaN,
      savingVsLowest: NaN,
      verdict: 'cannot-verify',
    };
  }
  const verdict: DealVerdict =
    foundPrice < stats.lowest
      ? 'real-deal'
      : foundPrice < stats.current
        ? 'below-current'
        : 'not-a-deal';
  return {
    foundPrice,
    current: stats.current,
    lowest: stats.lowest,
    highest: stats.highest,
    pointCount: stats.pointCount,
    savingVsCurrent:
      Math.round((stats.current - foundPrice) * 100) / 100,
    savingVsLowest:
      Math.round((stats.lowest - foundPrice) * 100) / 100,
    verdict,
  };
}

/** Parse the page's GET params: ?product=…&price=…. */
export function parseDealCheckerParams(searchParams: {
  product?: string | string[];
  price?: string | string[];
}): {
  productId: string | null;
  price: number | null;
  priceError: string | null;
} {
  const rawProduct = Array.isArray(searchParams.product)
    ? searchParams.product[0]
    : searchParams.product;
  const rawPrice = Array.isArray(searchParams.price)
    ? searchParams.price[0]
    : searchParams.price;

  let price: number | null = null;
  let priceError: string | null = null;
  if (rawPrice !== undefined && rawPrice.trim().length > 0) {
    const parsed = Number(rawPrice.replace(/,/g, ''));
    if (!Number.isFinite(parsed) || parsed <= 0) {
      priceError = `"${rawPrice}" is not a valid price — enter a positive number.`;
    } else {
      price = parsed;
    }
  }

  return {
    productId:
      rawProduct !== undefined && rawProduct.trim().length > 0
        ? rawProduct.trim()
        : null,
    price,
    priceError,
  };
}
