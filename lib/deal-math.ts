/**
 * Shared deal math — ONE place that computes discount percentages and
 * picks the best coupon, so surfaces stop computing these ad hoc.
 *
 * HONEST-BASIS NOTE (standing open decision, do not "fix" by fiat):
 * the Smart Deals widget / deals page show the deals table's
 * `discountPercentage`, while product-page rows derive their saving from
 * the merchant's `compare_at_price`. Neither is provably the single
 * correct source, and the user has not yet decided which basis wins.
 * This helper therefore computes the MERCHANT basis only
 * (compare_at_price vs price) and is wired into product-page rows as an
 * additive badge — it does NOT overwrite any deals-table percentage.
 * Applying it to the widget would change visible widget %s; that
 * change is deliberately left for the user's decision.
 *
 * HONEST CHECKOUT BOUNDARY: a website cannot auto-apply a code inside
 * a retailer's own checkout. Auto-apply exists only in the browser
 * extension's checkout panel (Phase 2). The website flow is: auto-find
 * the best currently-valid coupon + one-tap copy + a note that the
 * code is pasted at the retailer's checkout. Never claim otherwise.
 */

// Minimal coupon shape (camelCase, as returned by /api/v1/coupons).
export interface DealCoupon {
  code: string;
  merchantId?: string | null;
  description?: string | null;
  discountType: string;
  discountValue: number;
  minOrderValue?: number | null;
  maxDiscountAmount?: number | null;
  usageLimit?: number | null;
  usageCount?: number;
  validFrom?: string | null;
  validUntil?: string | null;
  active?: boolean;
}

/**
 * Merchant-basis discount percent, rounded to 1 decimal.
 * Returns null when there is no real saving (no compare-at price, or
 * compare-at <= price) — callers render no badge, never 0% or a
 * synthesized discount.
 */
export function discountPercent(price: number, compareAtPrice: number | null | undefined): number | null {
  if (compareAtPrice === null || compareAtPrice === undefined) return null;
  if (!Number.isFinite(price) || !Number.isFinite(compareAtPrice)) return null;
  if (compareAtPrice <= 0 || compareAtPrice <= price) return null;
  return Math.round(((compareAtPrice - price) / compareAtPrice) * 1000) / 10;
}

/**
 * Is this coupon currently usable? A coupon is NOT shown as active when:
 * - its active flag is false,
 * - its validity window has not started yet, or has already ended,
 * - its usage limit is reached (when a limit is set).
 * The /api/v1/coupons endpoint filters only the active flag, so
 * client surfaces must apply this check too — expired coupons must
 * never be shown as active.
 */
export function isCouponCurrentlyValid(coupon: DealCoupon, now: Date = new Date()): boolean {
  if (coupon.active === false) return false;
  const nowMs = now.getTime();
  if (coupon.validFrom) {
    const from = new Date(coupon.validFrom).getTime();
    if (Number.isFinite(from) && nowMs < from) return false;
  }
  if (coupon.validUntil) {
    const until = new Date(coupon.validUntil).getTime();
    if (Number.isFinite(until) && nowMs > until) return false;
  }
  if (coupon.usageLimit !== null && coupon.usageLimit !== undefined && coupon.usageCount !== undefined) {
    if (coupon.usageCount >= coupon.usageLimit) return false;
  }
  return true;
}

function couponRank(coupon: DealCoupon): [number, number] {
  // Deterministic "best" ranking. Percentage and fixed-amount discounts
  // cannot be compared without an order value, so percentage coupons
  // rank first (they scale with the order), then fixed-amount, each by
  // value descending. Documented rule, not a claim about real savings.
  const isPct = coupon.discountType === 'percentage';
  return [isPct ? 0 : 1, -(coupon.discountValue ?? 0)];
}

/**
 * Best currently-valid coupon for a merchant, or null.
 * Deterministic: valid only → rank (percentage first, value desc) →
 * earliest expiry → code alphabetically. Never returns an expired,
 * inactive, or usage-exhausted coupon.
 */
export function bestCoupon(coupons: DealCoupon[], now: Date = new Date()): DealCoupon | null {
  const valid = coupons.filter((c) => isCouponCurrentlyValid(c, now));
  if (valid.length === 0) return null;
  const sorted = [...valid].sort((a, b) => {
    const [aType, aVal] = couponRank(a);
    const [bType, bVal] = couponRank(b);
    if (aType !== bType) return aType - bType;
    if (aVal !== bVal) return aVal - bVal;
    const aExp = a.validUntil ? new Date(a.validUntil).getTime() : Number.POSITIVE_INFINITY;
    const bExp = b.validUntil ? new Date(b.validUntil).getTime() : Number.POSITIVE_INFINITY;
    if (aExp !== bExp) return aExp - bExp;
    return a.code.localeCompare(b.code);
  });
  return sorted[0];
}

/** Human-readable coupon value, e.g. "10% off" or "$15 off". */
export function couponValueLabel(coupon: DealCoupon): string {
  if (coupon.discountType === 'percentage') return `${coupon.discountValue}% off`;
  return `$${coupon.discountValue} off`;
}
