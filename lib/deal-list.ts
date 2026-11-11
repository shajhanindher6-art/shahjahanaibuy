/**
 * Pure list helpers for the deals page (Section 14, Chunk 4).
 *
 * The page used to paginate only when filters were active, sort
 * coupons by nothing at all, and offer no minimum-discount filter
 * — all three are fixed here with testable pure functions; the
 * page only wires them to state and the URL.
 */

export type DealSortKey = 'ai' | 'discount' | 'savings' | 'ending';

/**
 * One page of a list (1-based). Out-of-range pages return [] — the
 * caller clamps the page to totalPages first, so [] only means an
 * empty list, never a hidden one.
 */
export function paginateList<T>(items: T[], page: number, pageSize: number): T[] {
  const safePage = Math.max(1, page);
  const start = (safePage - 1) * pageSize;
  return items.slice(start, start + pageSize);
}

export interface CouponLike {
  discountValue: number;
  validUntil: string | null;
}

/**
 * Sort coupons by the shared deals sort control. 'discount' and
 * 'savings' both order by the listed discount value (a coupon's
 * discountValue is a % for percentage coupons and a $ amount for
 * fixed ones — the two are NOT converted into each other, so this
 * is "by listed value", not a cross-type saving claim). 'ending'
 * orders by expiry, soonest first, with no-expiry coupons last.
 * 'ai' keeps the fetched order.
 */
export function sortCoupons<T extends CouponLike>(coupons: T[], sort: DealSortKey): T[] {
  const sorted = [...coupons];
  switch (sort) {
    case 'discount':
    case 'savings':
      return sorted.sort((a, b) => b.discountValue - a.discountValue);
    case 'ending':
      return sorted.sort((a, b) => {
        const ea = a.validUntil ? new Date(a.validUntil).getTime() : Number.POSITIVE_INFINITY;
        const eb = b.validUntil ? new Date(b.validUntil).getTime() : Number.POSITIVE_INFINITY;
        return ea - eb;
      });
    default:
      return sorted;
  }
}

export interface DealLike {
  discountPercentage: number;
}

/**
 * Keep only deals at or above a minimum discount %. Null/0 means
 * no minimum — the list passes through unchanged.
 */
export function filterDealsByMinDiscount<T extends DealLike>(
  deals: T[],
  minDiscount: number | null
): T[] {
  if (minDiscount === null || minDiscount <= 0) return deals;
  return deals.filter((d) => d.discountPercentage >= minDiscount);
}
