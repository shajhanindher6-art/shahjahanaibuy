/**
 * Coupons & Cashback Finder — pure helpers for /tools/coupons-cashback
 * (Section 15, C1).
 *
 * The finder is the first PUBLIC page for coupons and cashback: until
 * now they existed only as APIs (`/api/v1/coupons`, `/api/v1/cashback`)
 * plus the per-product section on product pages. This module holds
 * only pure logic — param parsing, filtering, value labels — so it
 * is unit-testable without Supabase. Data still comes from the
 * existing services (`services/commerce.ts`: getCoupons,
 * getCashbackOffers, getMerchants); no second coupons backend.
 *
 * Honesty: the rows in the database today are demo/seed data (the
 * two known coupons are SAVE10 and BESTBUY15, valid to 2027-01-29).
 * They are NOT live merchant offers, so the page must label them
 * "Demo / seed data" and never present them as verified live
 * offers. DEMO_DATA_NOTE is the single source of that wording.
 *
 * Category filtering: coupons carry no product or category — they
 * are store-wide codes, so a category filter never hides a coupon.
 * Cashback offers may link to a product (`productId`); when one
 * does, its product's category decides the match, and a
 * product-less (store-wide) offer passes any category filter.
 */

import type { CashbackOffer, Coupon } from '@/types/catalog';

export const DEMO_DATA_NOTE =
  'Demo / seed data — these are sample offers from the SmartBuy demo catalog, not live merchant offers. Always check the code, the expiry and the terms on the merchant\u2019s own site before you buy.';

/** Offer kinds the finder can show. */
export type FinderKind = 'all' | 'coupons' | 'cashback';

export const FINDER_KINDS: FinderKind[] = ['all', 'coupons', 'cashback'];

export const FINDER_KIND_LABELS: Record<FinderKind, string> = {
  all: 'Coupons & cashback',
  coupons: 'Coupons only',
  cashback: 'Cashback only',
};

export interface FinderParams {
  /** Free-text search over code, title and description. */
  q: string;
  /** Merchant slug, or '' for all stores. */
  store: string;
  /** Which offer kind to show. */
  kind: FinderKind;
  /** Product category name, or '' for all categories. */
  category: string;
}

export const EMPTY_FINDER_PARAMS: FinderParams = {
  q: '',
  store: '',
  kind: 'all',
  category: '',
};

function firstParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}

/**
 * Parse the finder's GET query params. Unknown `kind` values fall
 * back to 'all'; everything else is trimmed, never trusted raw.
 */
export function parseFinderParams(searchParams: {
  q?: string | string[];
  store?: string | string[];
  kind?: string | string[];
  category?: string | string[];
}): FinderParams {
  const kindRaw = firstParam(searchParams.kind).trim().toLowerCase();
  const kind: FinderKind =
    kindRaw === 'coupons' || kindRaw === 'cashback' ? kindRaw : 'all';
  return {
    q: firstParam(searchParams.q).trim(),
    store: firstParam(searchParams.store).trim(),
    kind,
    category: firstParam(searchParams.category).trim(),
  };
}

export interface CouponFilter {
  q: string;
  /** Merchant id, or '' for all stores. */
  merchantId: string;
}

export interface CashbackFilter extends CouponFilter {
  /** Product category name, or '' for all categories. */
  category: string;
  /** productId → product category, for offers linked to a product. */
  productCategoryById: ReadonlyMap<string, string>;
}

function matchesQuery(haystack: string, q: string): boolean {
  if (!q) return true;
  return haystack.toLowerCase().includes(q.toLowerCase());
}

/**
 * Filter coupons by store and free-text search (code, description).
 * Coupons are store-wide, so they are never filtered by category.
 */
export function filterCoupons(
  coupons: readonly Coupon[],
  filter: CouponFilter
): Coupon[] {
  return coupons.filter((coupon) => {
    if (filter.merchantId && coupon.merchantId !== filter.merchantId) {
      return false;
    }
    return matchesQuery(
      `${coupon.code} ${coupon.description ?? ''}`,
      filter.q
    );
  });
}

/**
 * A cashback offer is expired once its end date has passed. Offers
 * with no end date never expire on this check. `getCashbackOffers`
 * does not date-filter (unlike getCoupons), so the finder applies
 * this itself — an expired offer is not an offer.
 */
export function isCashbackOfferExpired(
  offer: CashbackOffer,
  now: Date = new Date()
): boolean {
  if (!offer.endAt) return false;
  return new Date(offer.endAt).getTime() < now.getTime();
}

/**
 * Filter cashback offers by store, free-text search (title,
 * description), category (via the linked product, when linked) and
 * expiry. Expired offers are always excluded.
 */
export function filterCashbackOffers(
  offers: readonly CashbackOffer[],
  filter: CashbackFilter,
  now: Date = new Date()
): CashbackOffer[] {
  return offers.filter((offer) => {
    if (isCashbackOfferExpired(offer, now)) return false;
    if (filter.merchantId && offer.merchantId !== filter.merchantId) {
      return false;
    }
    if (filter.category) {
      const productCategory = offer.productId
        ? filter.productCategoryById.get(offer.productId)
        : undefined;
      // A linked product in another category does not match; a
      // store-wide offer (no product) passes any category filter.
      if (productCategory !== undefined && productCategory !== filter.category) {
        return false;
      }
    }
    return matchesQuery(
      `${offer.title} ${offer.description ?? ''}`,
      filter.q
    );
  });
}

/** "10% OFF" / "$15 OFF" — the label shown on a coupon card. */
export function formatCouponValue(coupon: Pick<Coupon, 'discountType' | 'discountValue'>): string {
  if (coupon.discountType === 'percentage') {
    return `${coupon.discountValue}% OFF`;
  }
  return `$${coupon.discountValue} OFF`;
}

/** "5% cashback" / "$10 cashback" — the label on a cashback card. */
export function formatCashbackValue(
  offer: Pick<CashbackOffer, 'cashbackType' | 'cashbackValue'>
): string {
  if (offer.cashbackType === 'percentage') {
    return `${offer.cashbackValue}% cashback`;
  }
  return `$${offer.cashbackValue} cashback`;
}

/**
 * Human expiry label: "Valid until 29 January 2027", or
 * "No expiry shown" when the row carries no end date.
 */
export function formatExpiry(validUntil: string | null): string {
  if (!validUntil) return 'No expiry shown';
  const date = new Date(validUntil);
  if (Number.isNaN(date.getTime())) return 'No expiry shown';
  return `Valid until ${date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })}`;
}
