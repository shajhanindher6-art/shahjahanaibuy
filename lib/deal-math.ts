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
 *
 * BASIS (Section 20, §12 #40): this is a discount "vs list price"
 * ONLY. `compare_at_price` is a merchant-stated list price that was
 * never observed in recorded price history — no code path has ever
 * seen the product sell (or be listed) at that price before the
 * current price. A discount computed here must therefore ALWAYS be
 * labelled with DISCOUNT_BASIS_LABEL ("vs list price") wherever it
 * is shown, and ranking must never present it as a verified saving.
 * Use discountPercentLabel() for the display string so the basis
 * travels with the number.
 */
export function discountPercent(price: number, compareAtPrice: number | null | undefined): number | null {
  if (compareAtPrice === null || compareAtPrice === undefined) return null;
  if (!Number.isFinite(price) || !Number.isFinite(compareAtPrice)) return null;
  if (compareAtPrice <= 0 || compareAtPrice <= price) return null;
  return Math.round(((compareAtPrice - price) / compareAtPrice) * 1000) / 10;
}

/**
 * The basis label for every discount computed by discountPercent
 * (Section 20, §12 #40). "vs list price" — the saving is measured
 * against the merchant's stated list (compare-at) price, not
 * against a price observed in recorded history. Render this
 * wherever a discount % is shown until an observed pre-rise price
 * exists for the product.
 */
export const DISCOUNT_BASIS_LABEL = 'vs list price';

/**
 * Display string for a merchant-basis discount, basis included:
 * "20% off vs list price", or null when there is no discount.
 * Callers that render a discount % must use this (or append
 * DISCOUNT_BASIS_LABEL themselves) — a bare "20% off" is a
 * claimed saving presented as verified, which §12 #40 forbids.
 */
export function discountPercentLabel(
  price: number,
  compareAtPrice: number | null | undefined
): string | null {
  const pct = discountPercent(price, compareAtPrice);
  if (pct === null) return null;
  return `${pct}% off ${DISCOUNT_BASIS_LABEL}`;
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

// ---------------------------------------------------------------------------
// Checkout verification (Section 19, Phase 2 §12 #22). Coupon
// "validity" in this repo is an expiry-date check only
// (isCouponCurrentlyValid) — nothing verifies the code works at
// the merchant. Merchant-feed liveness is owner-gated, so no code
// path here may ever claim a code works at checkout. The label
// below is shown wherever coupon validity is displayed (Auto
// Coupon Hub, product-page coupon rows). "Valid" means only that
// the code passed OUR OWN check (active flag, dates, usage limit)
// against the codes stored in our database — the retailer decides
// whether a code works at checkout, and we have not verified it
// with them. The history cross-check for the claimed discount
// lives in services/deal-validation.ts
// (checkCouponDiscountAgainstHistory), next to the detectors it
// reuses — lib/ must not import services/.
// ---------------------------------------------------------------------------

/**
 * The label shown wherever coupon validity is displayed.
 */
export const COUPON_CHECKOUT_UNVERIFIED_LABEL =
  'Checkout unverified — this code has not been confirmed to work at the merchant checkout';
