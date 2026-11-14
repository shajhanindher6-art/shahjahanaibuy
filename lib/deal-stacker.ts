/**
 * AI Deal Stacker — pure stack math for /tools/deal-stacker (T8).
 *
 * NEW MATH (does not exist anywhere else in the tree): `bestCoupon`
 * in lib/deal-math.ts picks ONE best coupon; this module COMBINES
 * the three recorded-data components of a deal into one stack:
 *
 *   best currently-valid coupon + best applicable cashback offer
 *   + recorded price drop, each shown separately with its source.
 *
 * THE DROP IS NOT DOUBLE-COUNTED. The recorded drop is the fall
 * from the previous recorded price to the latest recorded price, so
 * the stack's base price is the PREVIOUS recorded price and the
 * total is:
 *
 *   stacked total = previous recorded price − drop − coupon − cashback
 *                 = latest recorded price − coupon − cashback
 *   total saving  = drop + coupon + cashback  (vs the previous price)
 *
 * Subtracting the drop from the latest price as well would count
 * the same fall twice. The coupon and cashback are computed on the
 * latest recorded price — the price a buyer would actually pay
 * before those two apply.
 *
 * HONESTY (the whole point of the tool):
 * - Every component is math on RECORDED data only. No live prices,
 *   no invented coupons, no guessed checkout total.
 * - A coupon is used only when it is in the live coupons table AND
 *   currently valid (lib/deal-math.ts `isCouponCurrentlyValid` via
 *   `bestCoupon`, applied to the merchant-filtered list — a coupon
 *   for another store never stacks here). Expired coupons never
 *   appear. A coupon's checkout is still unverified — the retailer
 *   decides whether a code works (see COUPON_CHECKOUT_UNVERIFIED_LABEL).
 * - A cashback offer is used only when it is active, started, not
 *   expired, and applies to this product at this merchant
 *   (product-linked, or store-wide when it carries no product).
 * - The stacked total is NEVER a guaranteed checkout total:
 *   taxes and shipping vary and the final price is the retailer's.
 * - The price carries its staleness (recorded date + age in days;
 *   stale past STALE_PRICE_DAYS, the same threshold as the rest of
 *   the site). No stack is shown for a product with no in-stock
 *   recorded listing — "no stack available", never a made-up price.
 *
 * Deterministic, zero LLM, no fetch, no scraping. Pure functions so
 * the math is unit-testable without Supabase; the page composes the
 * inputs from services/commerce.ts (getCoupons, getCashbackOffers,
 * getMerchantProducts) + services/price-history.ts (getPriceHistory).
 */

import type { CashbackOffer } from '@/types/catalog';
import {
  bestCoupon,
  type DealCoupon,
} from '@/lib/deal-math';
import { STALE_PRICE_DAYS } from '@/lib/price-freshness';

export type DealStackComponentKind = 'price-drop' | 'coupon' | 'cashback';

/** One stack component, with the source a reader can check. */
export interface DealStackComponent {
  kind: DealStackComponentKind;
  /** Short label, e.g. "Coupon SAVE10" or "Recorded price drop". */
  label: string;
  /** Where the component comes from, e.g. "Amazon coupon table". */
  source: string;
  /** Extra honest detail, e.g. the coupon expiry or the drop dates. */
  detail: string;
  /** Dollars saved by this component (rounded to cents, >= 0). */
  amount: number;
}

/** A recorded price point (latest-first order is NOT assumed). */
export interface StackPricePoint {
  price: number;
  recordedAt: string;
}

/** The recorded fall from the previous price to the latest price. */
export interface RecordedDrop {
  amount: number;
  fromPrice: number;
  fromRecordedAt: string;
  toPrice: number;
  toRecordedAt: string;
}

export interface DealStackInput {
  productId: string;
  productName: string;
  productSlug: string;
  /** Merchant of the lowest in-stock recorded listing, or null. */
  merchantId: string | null;
  merchantName: string | null;
  /** Lowest in-stock recorded price, or null when there is none. */
  lowestPrice: number | null;
  /** When that listing price was last synced, or null. */
  priceRecordedAt: string | null;
  /** Recorded price history points for the product. */
  historyPoints: StackPricePoint[];
  /** Coupons from the live coupons table (any merchant). */
  coupons: DealCoupon[];
  /** Cashback offers from the live cashback_offers table. */
  cashbackOffers: CashbackOffer[];
  now?: Date;
}

export interface DealStack {
  productId: string;
  productName: string;
  productSlug: string;
  merchantId: string | null;
  merchantName: string | null;
  /** The price the stack starts from (previous recorded price when a drop exists, else the latest recorded price). */
  basePrice: number | null;
  /** Latest recorded (lowest in-stock) price. */
  currentPrice: number | null;
  priceRecordedAt: string | null;
  /** Days since the price was recorded, or null when unknown. */
  priceAgeDays: number | null;
  /** True when the recorded price is older than STALE_PRICE_DAYS. */
  priceStale: boolean;
  components: DealStackComponent[];
  /** Sum of the components (vs the base price). */
  totalSaving: number | null;
  /** Base price minus total saving — never a guaranteed checkout total. */
  stackedTotal: number | null;
  /** True when at least one component applies. */
  hasStack: boolean;
  /** Why there is no stack, when hasStack is false. */
  noStackReason: string | null;
}

/** Dollars, rounded to cents. */
export function roundCents(value: number): number {
  return Math.round(value * 100) / 100;
}

/** "$1,234.56" — the one money format for this tool's page. */
export function formatUsd(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

/**
 * Dollars a coupon saves on a given price. Percentage coupons are
 * capped by maxDiscountAmount; fixed coupons never save more than
 * the price itself; a price below minOrderValue saves nothing.
 * Returns 0 for an invalid coupon or price — never a negative.
 */
export function couponSaving(coupon: DealCoupon, price: number): number {
  if (!Number.isFinite(price) || price <= 0) return 0;
  if (!Number.isFinite(coupon.discountValue) || coupon.discountValue <= 0) return 0;
  if (
    coupon.minOrderValue !== null &&
    coupon.minOrderValue !== undefined &&
    price < coupon.minOrderValue
  ) {
    return 0;
  }
  let saving: number;
  if (coupon.discountType === 'percentage') {
    saving = (price * coupon.discountValue) / 100;
    if (
      coupon.maxDiscountAmount !== null &&
      coupon.maxDiscountAmount !== undefined
    ) {
      saving = Math.min(saving, coupon.maxDiscountAmount);
    }
  } else {
    saving = Math.min(coupon.discountValue, price);
  }
  return roundCents(Math.max(0, saving));
}

/**
 * Dollars a cashback offer returns on a given price. Percentage
 * cashback is capped by maxCashbackAmount; fixed cashback never
 * exceeds the price. Returns 0 for an invalid offer or price.
 */
export function cashbackSaving(offer: CashbackOffer, price: number): number {
  if (!Number.isFinite(price) || price <= 0) return 0;
  if (!Number.isFinite(offer.cashbackValue) || offer.cashbackValue <= 0) return 0;
  let saving: number;
  if (offer.cashbackType === 'percentage') {
    saving = (price * offer.cashbackValue) / 100;
    if (
      offer.maxCashbackAmount !== null &&
      offer.maxCashbackAmount !== undefined
    ) {
      saving = Math.min(saving, offer.maxCashbackAmount);
    }
  } else {
    saving = Math.min(offer.cashbackValue, price);
  }
  return roundCents(Math.max(0, saving));
}

/**
 * Is this cashback offer usable right now? Active flag on, started,
 * and not yet expired. `getCashbackOffers` does not date-filter
 * (unlike getCoupons), so the stacker applies this itself — an
 * expired offer is not an offer.
 */
export function isCashbackOfferCurrentlyValid(
  offer: CashbackOffer,
  now: Date = new Date()
): boolean {
  if (!offer.active) return false;
  const nowMs = now.getTime();
  if (offer.startAt) {
    const start = new Date(offer.startAt).getTime();
    if (Number.isFinite(start) && nowMs < start) return false;
  }
  if (offer.endAt) {
    const end = new Date(offer.endAt).getTime();
    if (Number.isFinite(end) && nowMs > end) return false;
  }
  return true;
}

/**
 * The recorded price drop: the fall from the previous recorded
 * point to the latest recorded point. Returns null when there are
 * fewer than two parseable points, or the latest price did not fall
 * (flat or up — no drop to stack). Points are sorted by recorded
 * date, newest first; a caller must not rely on input order.
 */
export function recordedDrop(
  points: StackPricePoint[]
): RecordedDrop | null {
  const valid = points
    .filter(
      (p) =>
        Number.isFinite(p.price) &&
        p.price > 0 &&
        Number.isFinite(new Date(p.recordedAt).getTime())
    )
    .sort(
      (a, b) =>
        new Date(b.recordedAt).getTime() - new Date(a.recordedAt).getTime()
    );
  if (valid.length < 2) return null;
  const latest = valid[0];
  const previous = valid[1];
  if (previous.price <= latest.price) return null;
  return {
    amount: roundCents(previous.price - latest.price),
    fromPrice: previous.price,
    fromRecordedAt: previous.recordedAt,
    toPrice: latest.price,
    toRecordedAt: latest.recordedAt,
  };
}

/**
 * Best applicable cashback offer for this product at this merchant:
 * currently valid, for this merchant, and either linked to this
 * product or store-wide (no product link). "Best" is the largest
 * dollar saving on the given price; ties break by earliest expiry,
 * then title. Returns null (with a 0 saving) when nothing applies.
 */
export function bestCashbackForStack(
  offers: CashbackOffer[],
  merchantId: string | null,
  productId: string,
  price: number,
  now: Date = new Date()
): { offer: CashbackOffer; saving: number } | null {
  const applicable = offers
    .filter((offer) => isCashbackOfferCurrentlyValid(offer, now))
    .filter((offer) => merchantId !== null && offer.merchantId === merchantId)
    .filter(
      (offer) => offer.productId === null || offer.productId === productId
    )
    .map((offer) => ({ offer, saving: cashbackSaving(offer, price) }))
    .filter(({ saving }) => saving > 0);
  if (applicable.length === 0) return null;
  applicable.sort((a, b) => {
    if (b.saving !== a.saving) return b.saving - a.saving;
    const aEnd = a.offer.endAt
      ? new Date(a.offer.endAt).getTime()
      : Number.POSITIVE_INFINITY;
    const bEnd = b.offer.endAt
      ? new Date(b.offer.endAt).getTime()
      : Number.POSITIVE_INFINITY;
    if (aEnd !== bEnd) return aEnd - bEnd;
    return a.offer.title.localeCompare(b.offer.title);
  });
  return applicable[0];
}

function formatStackDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/**
 * Build the best stack for one product from recorded data only.
 * The coupon comes from `bestCoupon` (lib/deal-math.ts) applied to
 * the coupons for this merchant — store-wide codes (no merchant)
 * plus this merchant's own codes — after `isCouponCurrentlyValid`
 * filtering, so an expired, inactive, or usage-exhausted coupon
 * never stacks. The cashback is the best applicable offer; the
 * drop is the recorded fall from the previous price point.
 * A product with no in-stock recorded listing, or with no drop,
 * coupon, and cashback at all, gets hasStack false and a reason —
 * never an invented component.
 */
export function buildDealStack(input: DealStackInput): DealStack {
  const now = input.now ?? new Date();
  const recordedAt = input.priceRecordedAt;
  const ageMs =
    recordedAt !== null
      ? now.getTime() - new Date(recordedAt).getTime()
      : Number.NaN;
  const priceAgeDays = Number.isFinite(ageMs)
    ? Math.max(0, Math.floor(ageMs / 86_400_000))
    : null;
  const priceStale =
    priceAgeDays !== null && priceAgeDays > STALE_PRICE_DAYS;

  const base: Omit<DealStack, 'components' | 'totalSaving' | 'stackedTotal' | 'hasStack' | 'noStackReason'> = {
    productId: input.productId,
    productName: input.productName,
    productSlug: input.productSlug,
    merchantId: input.merchantId,
    merchantName: input.merchantName,
    basePrice: input.lowestPrice,
    currentPrice: input.lowestPrice,
    priceRecordedAt: recordedAt,
    priceAgeDays,
    priceStale,
  };

  if (input.lowestPrice === null || !Number.isFinite(input.lowestPrice)) {
    return {
      ...base,
      basePrice: null,
      currentPrice: null,
      components: [],
      totalSaving: null,
      stackedTotal: null,
      hasStack: false,
      noStackReason:
        'No in-stock recorded listing for this product, so there is no recorded price to stack anything onto.',
    };
  }

  const price = input.lowestPrice;
  const drop = recordedDrop(input.historyPoints);
  const components: DealStackComponent[] = [];

  if (drop !== null) {
    components.push({
      kind: 'price-drop',
      label: 'Recorded price drop',
      source: 'Recorded price history',
      detail: `Fell from ${formatUsd(drop.fromPrice)} on ${formatStackDate(drop.fromRecordedAt)} to ${formatUsd(drop.toPrice)} on ${formatStackDate(drop.toRecordedAt)}.`,
      amount: drop.amount,
    });
  }

  // Coupons for this merchant only: store-wide codes plus this
  // merchant's own codes. bestCoupon re-checks validity
  // (active flag, dates, usage limit) — an expired coupon never
  // reaches the stack even if the service already filtered.
  const merchantCoupons = input.coupons.filter(
    (coupon) =>
      coupon.merchantId === null ||
      coupon.merchantId === undefined ||
      coupon.merchantId === input.merchantId
  );
  const coupon = bestCoupon(merchantCoupons, now);
  if (coupon !== null) {
    const saving = couponSaving(coupon, price);
    if (saving > 0) {
      components.push({
        kind: 'coupon',
        label: `Coupon ${coupon.code}`,
        source: `Coupons table — ${input.merchantName ?? 'this store'}`,
        detail: `${coupon.discountType === 'percentage' ? `${coupon.discountValue}% off` : `${formatUsd(coupon.discountValue)} off`}${coupon.validUntil ? `, valid until ${formatStackDate(coupon.validUntil)}` : ''}. Enter the code at the retailer's checkout — SmartBuy never applies it.`,
        amount: saving,
      });
    }
  }

  const cashback = bestCashbackForStack(
    input.cashbackOffers,
    input.merchantId,
    input.productId,
    price,
    now
  );
  if (cashback !== null) {
    components.push({
      kind: 'cashback',
      label: cashback.offer.title,
      source: `Cashback offer — ${input.merchantName ?? 'this store'}`,
      detail: `${cashback.offer.cashbackType === 'percentage' ? `${cashback.offer.cashbackValue}% back` : `${formatUsd(cashback.offer.cashbackValue)} back`} on this purchase${cashback.offer.endAt ? `, ends ${formatStackDate(cashback.offer.endAt)}` : ''}.`,
      amount: cashback.saving,
    });
  }

  if (components.length === 0) {
    return {
      ...base,
      components: [],
      totalSaving: null,
      stackedTotal: null,
      hasStack: false,
      noStackReason:
        'Nothing stacks for this product right now: no recorded price drop, no currently-valid coupon for this store, and no applicable cashback offer.',
    };
  }

  const totalSaving = roundCents(
    components.reduce((sum, c) => sum + c.amount, 0)
  );
  // Base is the pre-drop recorded price when a drop exists, so the
  // drop is counted once: base − drop = latest price, then the
  // coupon and cashback come off the latest price.
  const basePrice = drop !== null ? drop.fromPrice : price;
  return {
    ...base,
    basePrice,
    components,
    totalSaving,
    stackedTotal: roundCents(basePrice - totalSaving),
    hasStack: true,
    noStackReason: null,
  };
}
