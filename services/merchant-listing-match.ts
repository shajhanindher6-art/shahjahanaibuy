/**
 * FINAL 100% — manual merchant-listing matching + match-confidence
 * persistence (F-P1-21 code part, F-P1-12, F-P2-40).
 *
 * Live truth (audit §1.1): 0/20 merchant rows carry a real
 * listing — every `url` is a search URL, `merchant_sku` is NULL
 * on all 20, `currency_id` is NULL on all 20. No code may present
 * those rows as "matched". This module is the tooling that fixes
 * that honestly:
 * - `isRealListingUrl` / `isSearchUrl`: a search URL (Amazon
 *   /s?k=, eBay /sch/, Best Buy searchpage) is never a listing;
 *   a real listing is Amazon /dp/ or /gp/product/, eBay /itm/,
 *   Best Buy /site/.../*.p with a skuId.
 * - `validateManualListingMatch`: the admin workflow's gate — a
 *   listing attach needs a product, a canonical merchant slug, a
 *   REAL listing URL, and a merchant SKU. A search URL or a
 *   missing SKU is rejected, never stored.
 * - `attachMerchantListing`: the admin attach (upsert of the
 *   merchant_products row) with `match_confidence` /
 *   `matched_by` written when those columns exist and dropped
 *   honestly (42703 retry) when they do not — the columns need a
 *   migration the owner applies; the writer is ready before it.
 *   A manual admin attach is confidence 1.0, matched_by
 *   'manual' — a human verified it.
 * - `writeListingMatchConfidence` / `readListingMatchConfidence`:
 *   the generic writer + reader for match confidence on any
 *   listing row (used by the eBay refresh path too). The reader
 *   returns null — never a guessed number — when the columns do
 *   not exist yet.
 * - `getRealListingCoverage`: honest reporting — total rows,
 *   real listings, search-URL-only rows, and the share. Today
 *   that reads 0/20 real; the function reports it as such.
 */

import type { AnySupabaseClient } from '@/lib/supabase/types';
import { logger } from '@/lib/config/logger';
import { canonicalMerchantSlug } from '@/lib/merchant-slugs';

/** Column names for match confidence (pending migration — see module header). */
export const MATCH_CONFIDENCE_COLUMN = 'match_confidence';
export const MATCHED_BY_COLUMN = 'matched_by';

export type ManualMatchMethod = 'manual';

export interface ManualListingMatchInput {
  productId: string;
  merchantSlug: string;
  /** Real listing URL — never a search URL. */
  listingUrl: string;
  /** Merchant's own SKU / item id for the listing. Required. */
  merchantSku: string;
  price?: number | null;
  currencyId?: string | null;
}

export interface ManualListingMatchValidation {
  valid: boolean;
  errors: string[];
  canonicalMerchantSlug: string | null;
}

/** Search-URL patterns, per merchant (a search URL is never a listing). */
const SEARCH_URL_PATTERNS: Array<{ merchant: string; pattern: RegExp }> = [
  { merchant: 'amazon', pattern: /\/s[\/??]/i },
  { merchant: 'amazon', pattern: /[?&]k=/i },
  { merchant: 'ebay', pattern: /\/sch\//i },
  { merchant: 'best-buy', pattern: /searchpage\.jsp/i },
  { merchant: 'best-buy', pattern: /\/site\/search/i },
];

/** Real-listing URL patterns, per merchant. */
const LISTING_URL_PATTERNS: Array<{ merchant: string; pattern: RegExp }> = [
  { merchant: 'amazon', pattern: /\/dp\/[A-Z0-9]{10}/i },
  { merchant: 'amazon', pattern: /\/gp\/product\/[A-Z0-9]{10}/i },
  { merchant: 'ebay', pattern: /\/itm\//i },
  { merchant: 'best-buy', pattern: /\/site\/[^/]+\/[^/]+\.p/i },
];

export function isSearchUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return SEARCH_URL_PATTERNS.some(
      ({ pattern }) => pattern.test(parsed.pathname + parsed.search)
    );
  } catch {
    return false;
  }
}

export function isRealListingUrl(url: string, merchantSlug?: string | null): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  if (isSearchUrl(url)) return false;
  const canonical = canonicalMerchantSlug(merchantSlug);
  const candidates = LISTING_URL_PATTERNS.filter(
    (p) => !canonical || p.merchant === canonical
  );
  const patterns = candidates.length > 0 ? candidates : LISTING_URL_PATTERNS;
  return patterns.some(({ pattern }) => pattern.test(parsed.pathname + parsed.search));
}

export function validateManualListingMatch(
  input: ManualListingMatchInput
): ManualListingMatchValidation {
  const errors: string[] = [];
  if (!input.productId || input.productId.trim() === '') {
    errors.push('productId is required');
  }
  const canonical = canonicalMerchantSlug(input.merchantSlug);
  if (!canonical) errors.push('merchantSlug is required');
  if (!input.listingUrl || input.listingUrl.trim() === '') {
    errors.push('listingUrl is required');
  } else if (isSearchUrl(input.listingUrl)) {
    errors.push(
      `listingUrl "${input.listingUrl}" is a search URL, not a product listing — a search URL is never a matched listing. Attach the listing's own page URL (e.g. an /itm/ or /dp/ URL).`
    );
  } else if (!isRealListingUrl(input.listingUrl, canonical)) {
    errors.push(
      `listingUrl "${input.listingUrl}" does not look like a real product listing URL for merchant "${canonical ?? input.merchantSlug}".`
    );
  }
  if (!input.merchantSku || input.merchantSku.trim() === '') {
    errors.push('merchantSku is required — a listing without the merchant\'s own SKU/item id cannot be matched.');
  }
  if (input.price !== undefined && input.price !== null && !(input.price > 0)) {
    errors.push('price, when given, must be greater than 0');
  }
  return { valid: errors.length === 0, errors, canonicalMerchantSlug: canonical };
}

function isUndefinedColumnError(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === '42703';
}

function isMissingTableError(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return code === 'PGRST205' || code === '42P01';
}

/**
 * Write match confidence onto a merchant_products row identified
 * by (product_id, merchant_id) — the eBay refresh path knows the
 * product + merchant but not the row id. Best-effort, never
 * throws; same 42703 semantics as writeListingMatchConfidence.
 */
export async function writeListingMatchConfidenceByProduct(
  supabase: AnySupabaseClient,
  productId: string,
  merchantId: string,
  confidence: number,
  matchedBy: string
): Promise<{ written: boolean; columnsMissing: boolean }> {
  try {
    const { data, error } = await supabase
      .from('merchant_products')
      .select('id')
      .eq('product_id', productId)
      .eq('merchant_id', merchantId)
      .maybeSingle();
    if (error || !data) return { written: false, columnsMissing: false };
    return writeListingMatchConfidence(
      supabase,
      (data as { id: string }).id,
      confidence,
      matchedBy
    );
  } catch (err) {
    logger.warn('writeListingMatchConfidenceByProduct: unexpected failure', {
      error: String(err),
    });
    return { written: false, columnsMissing: false };
  }
}

export interface ListingMatchConfidence {
  matchConfidence: number | null;
  matchedBy: string | null;
  /** True when the columns do not exist yet (migration not applied). */
  columnsMissing: boolean;
}

/**
 * Write match confidence onto a merchant_products row. Tries
 * with the confidence columns first, retries without them on
 * 42703 — the row is still attached, and the confidence is
 * honestly unwritten until the columns exist. Never throws.
 */
export async function writeListingMatchConfidence(
  supabase: AnySupabaseClient,
  merchantProductId: string,
  confidence: number,
  matchedBy: string
): Promise<{ written: boolean; columnsMissing: boolean }> {
  const withColumns = async () => {
    const res = await supabase
      .from('merchant_products')
      .update({ match_confidence: confidence, matched_by: matchedBy })
      .eq('id', merchantProductId);
    return res.error as { code?: string; message: string } | null;
  };
  try {
    const error = await withColumns();
    if (error && isUndefinedColumnError(error)) {
      return { written: false, columnsMissing: true };
    }
    if (error) {
      logger.warn('writeListingMatchConfidence: update failed', { error: error.message });
      return { written: false, columnsMissing: false };
    }
    return { written: true, columnsMissing: false };
  } catch (err) {
    logger.warn('writeListingMatchConfidence: unexpected failure', { error: String(err) });
    return { written: false, columnsMissing: false };
  }
}

/**
 * Read match confidence off a merchant_products row. Returns
 * nulls — never a guessed number — when the columns (or the
 * row) do not exist. Never throws.
 */
export async function readListingMatchConfidence(
  supabase: AnySupabaseClient,
  merchantProductId: string
): Promise<ListingMatchConfidence> {
  try {
    const { data, error } = await supabase
      .from('merchant_products')
      .select('match_confidence, matched_by')
      .eq('id', merchantProductId)
      .maybeSingle();
    if (error) {
      if (isUndefinedColumnError(error) || isMissingTableError(error)) {
        return { matchConfidence: null, matchedBy: null, columnsMissing: true };
      }
      logger.warn('readListingMatchConfidence: read failed', { error: error.message });
      return { matchConfidence: null, matchedBy: null, columnsMissing: false };
    }
    if (!data) return { matchConfidence: null, matchedBy: null, columnsMissing: false };
    const row = data as Record<string, unknown>;
    const confidence = typeof row.match_confidence === 'number' ? row.match_confidence : null;
    const matchedBy = typeof row.matched_by === 'string' ? row.matched_by : null;
    return { matchConfidence: confidence, matchedBy, columnsMissing: false };
  } catch (err) {
    logger.warn('readListingMatchConfidence: unexpected failure', { error: String(err) });
    return { matchConfidence: null, matchedBy: null, columnsMissing: false };
  }
}

export interface AttachMerchantListingResult {
  ok: boolean;
  merchantProductId?: string;
  /** True when the confidence columns did not exist (row attached, confidence unwritten). */
  confidenceNotStored?: boolean;
  errors: string[];
}

/**
 * Admin manual listing attach (F-P1-21). Validates first (a
 * search URL or a missing SKU never reaches the DB), resolves
 * the merchant row by canonical slug (never auto-created), then
 * upserts the merchant_products row with the real listing URL +
 * SKU and confidence 1.0 / matched_by 'manual'. The confidence
 * write is best-effort via `writeListingMatchConfidence` so an
 * unapplied confidence-columns migration never fails the attach.
 * Never throws.
 */
export async function attachMerchantListing(
  supabase: AnySupabaseClient,
  input: ManualListingMatchInput
): Promise<AttachMerchantListingResult> {
  const validation = validateManualListingMatch(input);
  if (!validation.valid) return { ok: false, errors: validation.errors };
  const merchantSlug = validation.canonicalMerchantSlug as string;
  try {
    const { data: merchant, error: merchantError } = await supabase
      .from('merchants')
      .select('id, slug')
      .eq('slug', merchantSlug)
      .maybeSingle();
    if (merchantError || !merchant) {
      return {
        ok: false,
        errors: [
          `Unknown merchant "${merchantSlug}" — merchants are never auto-created; add the merchant first.`,
        ],
      };
    }
    const merchantId = (merchant as { id: string }).id;
    const { data: product, error: productError } = await supabase
      .from('products')
      .select('id')
      .eq('id', input.productId)
      .maybeSingle();
    if (productError || !product) {
      return { ok: false, errors: [`Unknown product "${input.productId}".`] };
    }
    const { data: existing } = await supabase
      .from('merchant_products')
      .select('id')
      .eq('product_id', input.productId)
      .eq('merchant_id', merchantId)
      .maybeSingle();
    const nowIso = new Date().toISOString();
    const baseRow: Record<string, unknown> = {
      url: input.listingUrl.trim(),
      merchant_sku: input.merchantSku.trim(),
      updated_at: nowIso,
      ...(input.price !== undefined && input.price !== null ? { price: input.price } : {}),
      ...(input.currencyId ? { currency_id: input.currencyId } : {}),
    };
    let merchantProductId: string | undefined;
    if (existing) {
      const { error } = await supabase
        .from('merchant_products')
        .update(baseRow)
        .eq('id', (existing as { id: string }).id);
      if (error) return { ok: false, errors: [`Failed to update merchant listing: ${error.message}`] };
      merchantProductId = (existing as { id: string }).id;
    } else {
      const { data, error } = await supabase
        .from('merchant_products')
        .insert({
          product_id: input.productId,
          merchant_id: merchantId,
          ...baseRow,
        })
        .select('id')
        .single();
      if (error || !data) {
        return { ok: false, errors: [`Failed to attach merchant listing: ${error?.message ?? 'unknown error'}`] };
      }
      merchantProductId = (data as { id: string }).id;
    }
    const confidence = await writeListingMatchConfidence(
      supabase,
      merchantProductId,
      1,
      'manual'
    );
    return {
      ok: true,
      merchantProductId,
      confidenceNotStored: confidence.columnsMissing,
      errors: [],
    };
  } catch (err) {
    logger.warn('attachMerchantListing: unexpected failure', { error: String(err) });
    return { ok: false, errors: [String(err)] };
  }
}

export interface RealListingCoverage {
  /** merchant_products rows read (0 when the table is missing). */
  totalRows: number;
  /** Rows with a merchant SKU AND a real listing URL. */
  realListings: number;
  /** Rows that are search URLs (or SKU-less) — never "matched". */
  searchUrlOnly: number;
  /** Share of rows that are real listings (null when totalRows is 0). */
  realShare: number | null;
  /** True when the merchant_products table could not be read. */
  tableMissing: boolean;
}

/**
 * Honest listing coverage (F-P1-21 reporting). Counts real
 * listings — SKU present AND URL a real listing URL — against
 * all merchant rows. Live today this is 0/20 real; the function
 * reports exactly that, never as "matched".
 */
export async function getRealListingCoverage(
  supabase: AnySupabaseClient
): Promise<RealListingCoverage> {
  try {
    const { data, error } = await supabase
      .from('merchant_products')
      .select('url, merchant_sku, merchant_id')
      .limit(5000);
    if (error) {
      if (isMissingTableError(error)) {
        return { totalRows: 0, realListings: 0, searchUrlOnly: 0, realShare: null, tableMissing: true };
      }
      logger.warn('getRealListingCoverage: read failed', { error: error.message });
      return { totalRows: 0, realListings: 0, searchUrlOnly: 0, realShare: null, tableMissing: true };
    }
    const rows = (data ?? []) as Array<{ url: string | null; merchant_sku: string | null }>;
    let real = 0;
    for (const row of rows) {
      if (row.merchant_sku && row.url && isRealListingUrl(row.url)) real += 1;
    }
    return {
      totalRows: rows.length,
      realListings: real,
      searchUrlOnly: rows.length - real,
      realShare: rows.length > 0 ? real / rows.length : null,
      tableMissing: false,
    };
  } catch (err) {
    logger.warn('getRealListingCoverage: unexpected failure', { error: String(err) });
    return { totalRows: 0, realListings: 0, searchUrlOnly: 0, realShare: null, tableMissing: true };
  }
}
