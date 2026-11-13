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

import { INTAKE_SOURCE, EBAY_INTAKE_SOURCE } from '@/lib/intake-sources';
import { STALE_PRICE_DAYS, getPriceAgeDays } from '@/lib/price-freshness';
import type { AnySupabaseClient } from '@/lib/supabase/types';
import { logger } from '@/lib/config/logger';

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
 *    PREVIEW time — 'verified' with verified_at = the preview
 *    fetch time (Sections 21–25, Stage D, R2: stamping the
 *    approve time used to claim the price was checked at approve
 *    time, when the check happened at preview). When the preview
 *    time was not carried into the approve call, verified_at is
 *    null — "verified, check time not recorded" — never the
 *    approve time.
 * Any other source is rejected by the caller (the intake route
 * already rejects unknown sources); this function throws so a
 * new source cannot silently slip in as verified.
 */
export function priceVerificationForIntakeSource(
  source: typeof INTAKE_SOURCE | typeof EBAY_INTAKE_SOURCE,
  verifiedAt: string | null
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

// ---------------------------------------------------------------------------
// Section 20, §12 #68 — verified → stale transition.
//
// The 'stale' value existed in the enum but nothing ever wrote it
// (audit §1 #9): a price verified in November would read
// "Verified" forever. The refresh chain now flips it: a row whose
// status is 'verified' and whose price_verified_at is older than
// STALE_PRICE_DAYS becomes 'stale' — on BOTH the products rollup
// and the merchant_products rows, so the two never disagree.
//
// Fail-safe: migration 045 (the columns) is unapplied live, so the
// update answers 42703 / PGRST205 — that returns
// `{ columnsMissing: true }`, never a throw, and the refresh chain
// carries on. Any other error is reported in `error` and also
// never throws: staleness bookkeeping must never fail a refresh.
// ---------------------------------------------------------------------------

/** Pure predicate: should this verified price flip to 'stale'? */
export function shouldFlipVerifiedToStale(
  status: PriceVerificationStatus | string | null | undefined,
  verifiedAt: string | null | undefined,
  now: Date = new Date()
): boolean {
  if (status !== 'verified') return false;
  const age = getPriceAgeDays(verifiedAt, now);
  // FINAL 100% (F-P1-01): a "verified" stamp with NO check date
  // is verified forever unless it lapses here. A null age means
  // the currency of the check cannot be proven — the stamp is
  // not fresh, so it flips. (The old code returned false for a
  // null age, and the SQL below could never match a NULL
  // verified_at either, so a dateless verified stamp survived
  // every refresh.)
  return age === null || age > STALE_PRICE_DAYS;
}

// ---------------------------------------------------------------------------
// FINAL 100% (F-P0-02 + F-P0-03) — products rollup re-verification.
//
// The most load-bearing gap in the audit: `ebay-refresh` had zero
// `.update()` calls on `products`, so the 'verified' stamp landed
// on `merchant_products` only — even after the eBay unblock, no
// refresh could make a PRODUCT verified, because every public
// surface reads the products rollup. `markProductRefreshed`
// (services/freshness.ts) moves only refresh_status /
// data_freshness / next_refresh_at — never the verification
// columns — and that stays true: a re-read is not a verification.
//
// Call this ONLY after a real provider response was validated and
// saved (the eBay Browse leg, the pipeline `price.refresh`
// processor via services/pipeline-refresh.ts). NEVER call it from
// a re-read path, and NEVER stamp without evidence: `verifiedAt`
// must be the ISO time of the real check, and a missing or
// unparseable time is refused (the stamp is not written at all),
// never replaced with "now".
//
// Fail-safe: migration 045 (the columns) is unapplied live, so
// the update answers 42703 — that returns `{ columnsMissing:
// true }`, never a throw, and the caller carries on. Any other
// error is reported in `error` and also never throws.
// ---------------------------------------------------------------------------

export interface LiveVerificationEvidence {
  /** Which live source checked the price. Never 'manual-intake'. */
  source: PriceSource;
  /** ISO time of the real provider check. Required, must parse. */
  verifiedAt: string;
}

export interface MarkProductVerifiedResult {
  /** True when the products row now carries the verified stamp. */
  updated: boolean;
  /** True when the 045 columns do not exist yet (42703). */
  columnsMissing: boolean;
  error?: string;
}

export async function markProductVerified(
  supabase: AnySupabaseClient,
  productId: string,
  evidence: LiveVerificationEvidence
): Promise<MarkProductVerifiedResult> {
  const checkedAt = new Date(evidence.verifiedAt).getTime();
  if (!Number.isFinite(checkedAt)) {
    return {
      updated: false,
      columnsMissing: false,
      error: 'Refusing to stamp verified: the check time is missing or not a valid date.',
    };
  }
  if (evidence.source === 'manual-intake') {
    return {
      updated: false,
      columnsMissing: false,
      error: 'Refusing to stamp verified: manual-intake is never a verification.',
    };
  }
  try {
    const { error } = await supabase
      .from('products')
      .update({
        price_verification_status: 'verified',
        price_verified_at: new Date(checkedAt).toISOString(),
      })
      .eq('id', productId);
    if (error) {
      if (isMissingColumnOrTableError(error)) {
        return { updated: false, columnsMissing: true };
      }
      logger.warn('markProductVerified: products update failed', {
        productId,
        error: error.message,
      });
      return { updated: false, columnsMissing: false, error: error.message };
    }
    return { updated: true, columnsMissing: false };
  } catch (err) {
    logger.warn('markProductVerified: unexpected error', {
      productId,
      error: String(err),
    });
    return { updated: false, columnsMissing: false, error: String(err) };
  }
}

export interface FlipStaleVerificationResult {
  flippedProducts: number;
  flippedMerchantRows: number;
  /** True when the 045 columns do not exist yet (42703/PGRST205). */
  columnsMissing: boolean;
  error?: string;
}

/** True when the error means "this column/table does not exist (yet)". */
function isMissingColumnOrTableError(error: { code?: string } | null): boolean {
  if (!error) return false;
  return error.code === '42703' || error.code === '42P01' || error.code === 'PGRST205';
}

/**
 * Flip every verified price older than STALE_PRICE_DAYS to 'stale'.
 * Best-effort and never throwing — callers (the refresh chain)
 * await it inline. Returns the counts flipped, or
 * `columnsMissing: true` while migration 045 is unapplied.
 */
export async function flipStaleVerificationStatuses(
  supabase: AnySupabaseClient,
  now: Date = new Date()
): Promise<FlipStaleVerificationResult> {
  const cutoff = new Date(now.getTime() - STALE_PRICE_DAYS * 86_400_000).toISOString();
  const result: FlipStaleVerificationResult = {
    flippedProducts: 0,
    flippedMerchantRows: 0,
    columnsMissing: false,
  };
  try {
    const { data: products, error: productsError } = await supabase
      .from('products')
      .update({ price_verification_status: 'stale' })
      .eq('price_verification_status', 'verified')
      .lt('price_verified_at', cutoff)
      .select('id');
    if (productsError) {
      if (isMissingColumnOrTableError(productsError)) {
        return { ...result, columnsMissing: true };
      }
      logger.warn('flipStaleVerificationStatuses: products update failed', {
        error: productsError.message,
      });
      return { ...result, error: productsError.message };
    }
    result.flippedProducts = (products ?? []).length;

    // FINAL 100% (F-P1-01): a verified row with NO check date
    // never matched the `.lt(cutoff)` above (NULL never matches a
    // comparison), so a dateless stamp was verified forever. Flip
    // those rows too — a stamp whose check cannot be dated cannot
    // be shown as current.
    const { data: datelessProducts, error: datelessError } = await supabase
      .from('products')
      .update({ price_verification_status: 'stale' })
      .eq('price_verification_status', 'verified')
      .is('price_verified_at', null)
      .select('id');
    if (datelessError) {
      if (isMissingColumnOrTableError(datelessError)) {
        return { ...result, columnsMissing: true };
      }
      logger.warn('flipStaleVerificationStatuses: dateless products update failed', {
        error: datelessError.message,
      });
      return { ...result, error: datelessError.message };
    }
    result.flippedProducts += (datelessProducts ?? []).length;

    const { data: merchantRows, error: merchantError } = await supabase
      .from('merchant_products')
      .update({ price_verification_status: 'stale' })
      .eq('price_verification_status', 'verified')
      .lt('price_verified_at', cutoff)
      .is('deleted_at', null)
      .select('id');
    if (merchantError) {
      if (isMissingColumnOrTableError(merchantError)) {
        return { ...result, columnsMissing: true };
      }
      logger.warn('flipStaleVerificationStatuses: merchant_products update failed', {
        error: merchantError.message,
      });
      return { ...result, error: merchantError.message };
    }
    result.flippedMerchantRows = (merchantRows ?? []).length;
    const { data: datelessMerchantRows, error: datelessMerchantError } = await supabase
      .from('merchant_products')
      .update({ price_verification_status: 'stale' })
      .eq('price_verification_status', 'verified')
      .is('price_verified_at', null)
      .is('deleted_at', null)
      .select('id');
    if (datelessMerchantError) {
      if (isMissingColumnOrTableError(datelessMerchantError)) {
        return { ...result, columnsMissing: true };
      }
      logger.warn('flipStaleVerificationStatuses: dateless merchant_products update failed', {
        error: datelessMerchantError.message,
      });
      return { ...result, error: datelessMerchantError.message };
    }
    result.flippedMerchantRows += (datelessMerchantRows ?? []).length;
    return result;
  } catch (err) {
    logger.warn('flipStaleVerificationStatuses: unexpected error', {
      error: String(err),
    });
    return { ...result, error: String(err) };
  }
}
