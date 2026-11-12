/**
 * Section 17, Stage C item 14 — price-verification status.
 *
 * Pure helpers + constants for the columns migration 045 adds
 * (`products.price_verification_status` / `price_verified_at`,
 * `merchant_products.price_verification_status` / `price_source` /
 * `price_verified_at`). No DB access, no network — the API routes
 * and services import these, so the rules are stated once.
 *
 * The rule, in one line: a price is only ever called verified when
 * a real fetch checked it. Manual-intake prices are 'unverified'
 * by definition, and the UI must never call them "live" — the
 * label helpers below never emit the word "live" for a price.
 */

import { INTAKE_SOURCE } from './catalog-intake';
import { EBAY_INTAKE_SOURCE } from './ebay-intake';

/** Migration 045 CHECK values for products.status. */
export const PRODUCT_STATUSES = ['pending', 'published', 'rejected'] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

/** The only status public surfaces may show. */
export const PUBLISHED_PRODUCT_STATUS: ProductStatus = 'published';

/** Migration 045 CHECK values for price_verification_status. */
export const PRICE_VERIFICATION_STATUSES = ['unverified', 'verified', 'stale'] as const;
export type PriceVerificationStatus = (typeof PRICE_VERIFICATION_STATUSES)[number];

/** Migration 045 CHECK values for merchant_products.price_source. */
export const PRICE_SOURCES = ['manual-intake', 'ebay-browse-api', 'merchant-feed'] as const;
export type PriceSource = (typeof PRICE_SOURCES)[number];

/** A status value read back from a row that predates migration 045
 *  (or a row whose column is null) is 'unverified', never null —
 *  callers must not invent a verification that never happened. */
export function normalizePriceVerificationStatus(
  value: unknown
): PriceVerificationStatus {
  return value === 'verified' || value === 'stale' || value === 'unverified'
    ? value
    : 'unverified';
}

/** Same fail-open read for the publish gate: a row that predates
 *  migration 045 was already public, so it reads as 'published'. */
export function normalizeProductStatus(value: unknown): ProductStatus {
  return value === 'pending' || value === 'published' || value === 'rejected'
    ? value
    : 'published';
}

/**
 * Verification facts for a price entering the catalog at intake
 * time, by provenance. The intake route stamps exactly these
 * values on BOTH the products rollup and the merchant_products
 * row it inserts:
 *  - 'manual-intake': typed in by an admin, never fetched —
 *    'unverified', no verified_at. The UI renders this as
 *    "Unverified price — manually entered, not checked live".
 *  - 'ebay-browse-api': fetched from the eBay Browse API at
 *    approve time — 'verified' with verified_at = the approve
 *    timestamp. The UI renders "Verified — checked <date>".
 * Any other source is rejected by the caller (the intake route
 * already rejects unknown sources); this function throws so a
 * new source cannot silently slip in as verified.
 */
export function priceVerificationForIntakeSource(
  source: typeof INTAKE_SOURCE | typeof EBAY_INTAKE_SOURCE,
  verifiedAt: string
): {
  priceVerificationStatus: PriceVerificationStatus;
  priceSource: PriceSource;
  priceVerifiedAt: string | null;
} {
  if (source === EBAY_INTAKE_SOURCE) {
    return {
      priceVerificationStatus: 'verified',
      priceSource: 'ebay-browse-api',
      priceVerifiedAt: verifiedAt,
    };
  }
  if (source === INTAKE_SOURCE) {
    return {
      priceVerificationStatus: 'unverified',
      priceSource: 'manual-intake',
      priceVerifiedAt: null,
    };
  }
  throw new Error(`Unknown intake source "${source}" — cannot assign a verification status`);
}

/**
 * The honest one-line label for a shown price, plus a tone for
 * styling ('ok' | 'warn' | 'muted') and a short form for cards.
 * `verifiedAtLabel` is a pre-formatted date string (e.g. "12 Nov
 * 2026") or null. Never claims "live": the strongest true claim
 * is "Verified — checked <date>".
 */
export function priceVerificationLabel(
  status: PriceVerificationStatus,
  verifiedAtLabel: string | null
): { text: string; shortText: string; tone: 'ok' | 'warn' | 'muted' } {
  if (status === 'verified') {
    return {
      text: verifiedAtLabel
        ? `Verified price — checked ${verifiedAtLabel}`
        : 'Verified price',
      shortText: 'Verified price',
      tone: 'ok',
    };
  }
  if (status === 'stale') {
    return {
      text: verifiedAtLabel
        ? `Price check is stale — last verified ${verifiedAtLabel}`
        : 'Price check is stale — not verified recently',
      shortText: 'Price check stale',
      tone: 'warn',
    };
  }
  return {
    text: 'Unverified price — manually entered, not checked live',
    shortText: 'Unverified price',
    tone: 'muted',
  };
}
