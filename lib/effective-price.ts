/**
 * Stacked effective price — "you pay $X after deal + coupon +
 * cashback" (Section 14, Chunk 2, B6).
 *
 * Pure and deterministic. The deal %, coupon, and cashback are each
 * shown somewhere already (deals page, coupon hub, this section),
 * but no surface ever combined them into one "you pay" line.
 *
 * Inputs (all from recorded data, never invented):
 * - `price`: the current selling price (cheapest merchant listing).
 * - `listPrice`: the merchant compare-at price, or null when the
 *   listing has none. The deal saving is list − price; when there
 *   is no compare-at price there is no deal component.
 * - `coupon`: the best currently-valid coupon (percentage or fixed).
 * - `cashbackPct`: the cashback percentage of the amount actually
 *   paid (after coupon), or null when no percentage offer exists.
 *
 * Order: deal (already in the selling price) → coupon off the
 * selling price → cashback on the amount paid after coupon. Every
 * step floors at $0 — a fixed coupon larger than the price pays
 * $0, never a negative price. All money rounds to cents.
 *
 * The result is an ESTIMATE, labelled as such by callers: the
 * coupon applies at the retailer's checkout, not inside SmartBuy,
 * and cashback depends on the offer's terms.
 */

import { discountPercent } from '@/lib/deal-math';

export interface EffectivePriceCoupon {
  code: string;
  discountType: string;
  discountValue: number;
}

export interface EffectivePriceInput {
  /** Current selling price in USD. Must be finite and > 0. */
  price: number;
  /** Merchant compare-at (list) price in USD, or null when unknown. */
  listPrice?: number | null;
  /** Best currently-valid coupon, or null when none applies. */
  coupon?: EffectivePriceCoupon | null;
  /** Cashback % of the amount paid after coupon, or null. */
  cashbackPct?: number | null;
}

export interface EffectivePriceBreakdown {
  /** List (compare-at) price, or the selling price when unknown. */
  listPrice: number;
  /** $ saved by the deal (list − selling), 0 when no list price. */
  dealSaving: number;
  /** Deal saving as a %, or null when there is no list price. */
  dealPct: number | null;
  /** Price after the deal — always the selling price. */
  afterDeal: number;
  /** $ saved by the coupon, 0 when no coupon applies. */
  couponSaving: number;
  /** Coupon actually applied, or null. */
  couponApplied: EffectivePriceCoupon | null;
  /** Price after the coupon — what is paid at checkout. */
  afterCoupon: number;
  /** $ returned as cashback, 0 when no percentage offer exists. */
  cashbackAmount: number;
  /** Cashback % applied, or null. */
  cashbackPct: number | null;
  /** Effective cost after deal + coupon + cashback. */
  youPay: number;
  /** Total saving vs the list price (deal + coupon + cashback). */
  totalSaving: number;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function clampPct(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, n));
}

/**
 * Stack deal + coupon + cashback into one "you pay" breakdown, or
 * null when the selling price is missing/invalid. A coupon or
 * cashback the data does not support is simply a 0 component —
 * never a guessed saving.
 */
export function effectivePrice(input: EffectivePriceInput): EffectivePriceBreakdown | null {
  const price = input.price;
  if (!Number.isFinite(price) || price <= 0) return null;

  const listPrice =
    input.listPrice !== null &&
    input.listPrice !== undefined &&
    Number.isFinite(input.listPrice) &&
    (input.listPrice as number) > price
      ? (input.listPrice as number)
      : price;
  const dealSaving = round2(listPrice - price);
  // S2-5: the deal % IS the canonical merchant-basis derivation
  // (lib/deal-math.ts discountPercent: list price vs price, 1
  // decimal, null when the list price is not above the price) —
  // the inline formula it replaced was identical, so this is a
  // routing change only, not a new number.
  const dealPct = discountPercent(price, listPrice);
  const afterDeal = round2(price);

  let couponSaving = 0;
  let couponApplied: EffectivePriceCoupon | null = null;
  const coupon = input.coupon ?? null;
  if (coupon && Number.isFinite(coupon.discountValue) && coupon.discountValue > 0) {
    if (coupon.discountType === 'percentage') {
      couponSaving = round2((afterDeal * clampPct(coupon.discountValue)) / 100);
    } else {
      // Fixed-amount coupon ("$15 off") — capped at the price.
      couponSaving = round2(Math.min(afterDeal, coupon.discountValue));
    }
    if (couponSaving > 0) couponApplied = coupon;
  }
  const afterCoupon = round2(Math.max(0, afterDeal - couponSaving));

  const cashbackPct =
    input.cashbackPct !== null &&
    input.cashbackPct !== undefined &&
    Number.isFinite(input.cashbackPct) &&
    input.cashbackPct > 0
      ? clampPct(input.cashbackPct)
      : null;
  const cashbackAmount = cashbackPct !== null ? round2((afterCoupon * cashbackPct) / 100) : 0;

  const youPay = round2(Math.max(0, afterCoupon - cashbackAmount));
  return {
    listPrice: round2(listPrice),
    dealSaving,
    dealPct,
    afterDeal,
    couponSaving,
    couponApplied,
    afterCoupon,
    cashbackAmount,
    cashbackPct,
    youPay,
    totalSaving: round2(Math.max(0, listPrice - youPay)),
  };
}
