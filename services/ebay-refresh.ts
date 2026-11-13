/**
 * Section 15, P1-9 — eBay as the FIRST live price source (P1-2, P1-10).
 *
 * Until now the refresh chain re-read the database and re-recorded
 * it: nothing ever fetched a live price. This step runs FIRST in
 * POST /api/v1/prices/refresh (step 0), before refreshTrackedPrices,
 * so the recorded-price steps below it finally have fresh input:
 *
 *   per due product → eBay Browse search → keyword match → upsert
 *   merchant_products (eBay row) + data_freshness / next_refresh_at
 *   via the freshness policy layer.
 *
 * MATCHING IS KEYWORD-ONLY (no GTIN/brand match exists — the
 * listings carry no GTIN, and all 10 catalog products have
 * gtin: null). A listing matches only when EVERY token of the
 * product name (plus the brand token) appears in the listing
 * title, and the title contains no accessory word (case, cover,
 * charger, cable …). On ANY doubt the product is SKIPPED and
 * counted as `skippedMismatch` — a wrong-product price is never
 * recorded. The cheapest matching listing wins (Browse already
 * returns cheapest-first).
 *
 * HONEST LABELLING (non-negotiable):
 *   - NO price_history rows for eBay listings: a single snapshot
 *     of an ephemeral asking price is not a history. (History
 *     rows are written only by refreshTrackedPrices, from the
 *     recorded merchant_products rows, on change — the eBay row
 *     feeds that step like any other merchant row.)
 *   - NO Deal Score, NO "lowest ever", NO price-drop alerts on
 *     eBay rows. The product page labels the row "Live eBay asking
 *     price, checked <timestamp>" with data_freshness set at the
 *     moment of this check; a listing that later vanishes never
 *     triggers an alert (there is no history row to compare).
 *   - A vanished listing is simply not re-found next run: the old
 *     merchant_products row keeps its last checked price until
 *     the next successful check replaces it.
 *
 * ISOLATION (P1-2): per-product try/catch — one product's failure
 * never stops the others — plus a 10s timeout inside the adapter
 * and a retry (transient 429/5xx, up to 3 attempts, 500ms/1s
 * backoff). The whole step never throws: on an unexpected error
 * it returns `status: 'unavailable'` and the refresh route
 * degrades to "eBay unavailable, continued on recorded prices"
 * — the run NEVER fails because eBay did.
 *
 * MERCHANT ROW (owner-gated): the eBay `merchants` row does not
 * exist in the live DB (seed has eBay only in `retailers`). The
 * upsert fails honestly with `status: 'merchant-missing'` when
 * the row is absent — merchants are NEVER auto-created.
 *
 * BUDGET: every search attempt reserves one call from the global
 * daily budget (services/ebay-budget.ts, cap 4,500). At the cap
 * the run stops with `budgetExhausted: true`. Refresh math:
 * 4 runs/day × 10 products × 1 call ≈ 40 calls/day (~0.8% of
 * the 5,000/day free tier) — trivially safe while refresh is the
 * only caller; the public search + admin preview share the same
 * counter, so the cap still holds when they are used.
 */

import type { AnySupabaseClient } from '@/lib/supabase/types';
import { logger } from '@/lib/config/logger';
import { logApiError } from '@/lib/api/error-logging';
import { reportAiProviderHealth } from '@/services/ai-engine/health-report';
import {
  searchEbayListings,
  type EbaySearchResult,
} from './ebay-browse';
import {
  getProductsDueForRefresh,
  markProductRefreshed,
  markProductRefreshFailed,
  type RefreshPriority,
} from './freshness';
import { reserveEbayDailyCall } from './ebay-budget';

type FetchFn = typeof fetch;

export type EbayRefreshStatus =
  | 'ok'
  | 'not-configured'
  | 'merchant-missing'
  | 'budget-exhausted'
  | 'unavailable';

export type EbayProductOutcome =
  | 'updated'
  | 'inserted'
  | 'skipped-mismatch'
  | 'skipped-no-listing'
  | 'skipped-unknown-currency'
  | 'failed';

export interface EbayRefreshProductResult {
  productId: string;
  slug: string;
  outcome: EbayProductOutcome;
  price?: number;
  currency?: string;
}

export interface EbayRefreshResult {
  status: EbayRefreshStatus;
  checked: number;
  updated: number;
  inserted: number;
  skippedMismatch: number;
  skippedNoListing: number;
  skippedUnknownCurrency: number;
  failed: number;
  budgetExhausted: boolean;
  error?: string;
  products: EbayRefreshProductResult[];
}

export type EbaySearchFn = (
  query: string,
  options?: { limit?: number; fetchFn?: FetchFn }
) => Promise<EbaySearchResult>;

const MAX_PRODUCTS_PER_RUN = 10;
const SEARCH_LIMIT = 5;
const MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [500, 1000];

/**
 * Words that mark a listing as an accessory for the product
 * rather than the product itself. The match is deliberately
 * conservative: skipping a genuine bundle is harmless (the old
 * recorded price stands), recording a phone case as a phone
 * price is not.
 */
const ACCESSORY_WORDS = new Set([
  'case',
  'cover',
  'charger',
  'cable',
  'keyboard',
  'screen',
  'protector',
  'stand',
  'mount',
  'bag',
  'sleeve',
  'skin',
  'replacement',
  'battery',
  'adapter',
  'dock',
  'stylus',
  'strap',
  'band',
  'lens',
  'filter',
]);

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

/**
 * Keyword-only match: every product-name token AND the brand
 * token must appear in the listing title, and no accessory word
 * may appear. Exported for tests.
 */
export function ebayListingMatchesProduct(
  productName: string,
  productBrand: string | null,
  listingTitle: string
): boolean {
  const titleTokens = new Set(tokenize(listingTitle));
  const nameTokens = tokenize(productName);
  if (nameTokens.length === 0) return false;
  for (const token of nameTokens) {
    if (!titleTokens.has(token)) return false;
  }
  if (productBrand) {
    for (const token of tokenize(productBrand)) {
      if (!titleTokens.has(token)) return false;
    }
  }
  for (const token of titleTokens) {
    if (ACCESSORY_WORDS.has(token)) return false;
  }
  return true;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const ZERO_RESULT: EbayRefreshResult = {
  status: 'ok',
  checked: 0,
  updated: 0,
  inserted: 0,
  skippedMismatch: 0,
  skippedNoListing: 0,
  skippedUnknownCurrency: 0,
  failed: 0,
  budgetExhausted: false,
  products: [],
};

export async function refreshEbayPrices(
  supabase: AnySupabaseClient,
  options?: {
    searchFn?: EbaySearchFn;
    fetchFn?: FetchFn;
    /** Test-only: skip the real sleeps between retries. */
    noRetryDelay?: boolean;
  }
): Promise<EbayRefreshResult> {
  const result: EbayRefreshResult = {
    ...ZERO_RESULT,
    products: [],
  };
  const startedAt = Date.now();
  try {
    const inner = await refreshEbayPricesInner(supabase, result, options);
    // Section 20, §12 #52 — provider_health is written live for
    // the eBay adapter (best-effort; a missing provider_health
    // table never fails the run). Only real attempts are
    // recorded: 'ok' with at least one product checked is a
    // success; 'unavailable' is a failure. 'not-configured',
    // 'merchant-missing' and 'budget-exhausted' are config/cap
    // states, not provider health, and are not recorded.
    if (inner.checked > 0 && inner.status === 'ok') {
      await reportAiProviderHealth(supabase, 'ebay', {
        success: true,
        responseMs: Date.now() - startedAt,
      });
    } else if (inner.status === 'unavailable') {
      await reportAiProviderHealth(supabase, 'ebay', {
        success: false,
        responseMs: Date.now() - startedAt,
        ...(inner.error ? { error: inner.error.slice(0, 200) } : {}),
      });
    }
    return inner;
  } catch (err) {
    // The step never throws: an unexpected failure degrades the
    // run instead of failing it (the refresh route reports this
    // status and continues on recorded prices).
    logger.warn('refreshEbayPrices: unexpected failure', {
      error: String(err),
    });
    // Section 20, §12 #53 — an unexpected refresh failure is a
    // server error: it belongs in error_log, not just the warn log.
    logApiError(err, {
      route: 'ebay-refresh',
      status: 500,
      context: { phase: 'unexpected-failure' },
    });
    await reportAiProviderHealth(supabase, 'ebay', {
      success: false,
      responseMs: Date.now() - startedAt,
      error: String(err).slice(0, 200),
    });
    result.status = 'unavailable';
    result.error = err instanceof Error ? err.message : String(err);
    return result;
  }
}

/** True when the error means "column does not exist" (Postgres 42703). */
function isUndefinedColumnError(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === '42703';
}

/**
 * Section 20, §12 #25 — the verification stamp for a live-checked
 * eBay row (migration 045 columns on merchant_products). A row
 * written by a real Browse check reads 'verified' /
 * 'ebay-browse-api' with the check time — never the
 * 'unverified' / 'manual-intake' defaults a pre-045 row carries.
 */
function ebayVerificationStamp(nowIso: string): {
  price_verification_status: 'verified';
  price_source: 'ebay-browse-api';
  price_verified_at: string;
  last_synced_at: string;
} {
  return {
    price_verification_status: 'verified',
    price_source: 'ebay-browse-api',
    price_verified_at: nowIso,
    last_synced_at: nowIso,
  };
}

/**
 * Run a merchant_products write with the 045 stamp, retrying
 * WITHOUT the stamped columns on 42703 (migration 045 unapplied)
 * — the same fail-safe pattern as services/products.ts:115-130.
 * Any other error is returned as-is; the caller decides.
 */
async function writeEbayMerchantRow(
  write: (withStamp: boolean) => Promise<{
    error: { code?: string; message: string } | null;
  }>
): Promise<{ error: { code?: string; message: string } | null }> {
  const first = await write(true);
  if (first.error && isUndefinedColumnError(first.error)) {
    return write(false);
  }
  return first;
}

async function refreshEbayPricesInner(
  supabase: AnySupabaseClient,
  result: EbayRefreshResult,
  options?: {
    searchFn?: EbaySearchFn;
    fetchFn?: FetchFn;
    noRetryDelay?: boolean;
  }
): Promise<EbayRefreshResult> {
  const searchFn: EbaySearchFn =
    options?.searchFn ??
    ((query, opts) =>
      searchEbayListings(query, {
        limit: opts?.limit ?? SEARCH_LIMIT,
        fetchFn: options?.fetchFn,
      }));

  // The eBay merchants row must exist first. It does not in the
  // live DB today (owner-gated: the owner creates it via SQL).
  // Never auto-create it — fail honestly instead.
  const { data: merchant, error: merchantError } = await supabase
    .from('merchants')
    .select('id, slug')
    .eq('slug', 'ebay')
    .maybeSingle();
  if (merchantError || !merchant) {
    result.status = 'merchant-missing';
    result.error =
      'eBay merchant row is missing from the merchants table — the owner must create it via SQL; merchants are never auto-created';
    logger.warn('refreshEbayPrices: eBay merchant row missing', {
      error: merchantError?.message,
    });
    return result;
  }
  const ebayMerchantId = (merchant as { id: string }).id;

  const { data: currencyRows } = await supabase
    .from('currencies')
    .select('id, code');
  const currencyIdByCode = new Map<string, string>();
  for (const c of (currencyRows ?? []) as Array<{ id: string; code: string }>) {
    currencyIdByCode.set(c.code.trim().toUpperCase(), c.id);
  }

  // P1-10: the freshness policy layer decides which products are
  // due. Seeded rows have next_refresh_at defaulting to now(), so
  // the whole 10-product catalog is due on the first runs, then
  // each product becomes due again 6h after its last check.
  const due = await getProductsDueForRefresh(supabase, MAX_PRODUCTS_PER_RUN);
  if (due.length === 0) return result;
  const dueIds = due.map((d) => d.id);
  const { data: productRows, error: productError } = await supabase
    .from('products')
    .select('id, name, slug, brand, refresh_priority')
    .in('id', dueIds);
  if (productError || !productRows) {
    result.status = 'unavailable';
    result.error = `Could not load due products: ${productError?.message ?? 'no rows returned'}`;
    return result;
  }
  // Keep the policy layer's due order (priority, then oldest).
  const byId = new Map(
    (productRows as Array<{
      id: string;
      name: string;
      slug: string;
      brand: string | null;
      refresh_priority: number;
    }>).map((p) => [p.id, p])
  );
  const products = dueIds
    .map((id) => byId.get(id))
    .filter((p): p is NonNullable<typeof p> => Boolean(p))
    .slice(0, MAX_PRODUCTS_PER_RUN);

  for (const product of products) {
    result.checked += 1;
    try {
      const outcome = await refreshOneProduct(
        supabase,
        searchFn,
        ebayMerchantId,
        currencyIdByCode,
        product,
        result,
        options?.noRetryDelay ?? false
      );
      if (outcome === 'budget-exhausted') {
        result.budgetExhausted = true;
        result.status = 'budget-exhausted';
        break;
      }
      if (outcome === 'not-configured') {
        result.status = 'not-configured';
        result.error =
          'eBay is not configured (EBAY_CLIENT_ID / EBAY_CLIENT_SECRET missing)';
        break;
      }
    } catch (err) {
      logger.warn('refreshEbayPrices: product failed', {
        productId: product.id,
        error: String(err),
      });
      result.failed += 1;
      result.products.push({
        productId: product.id,
        slug: product.slug,
        outcome: 'failed',
      });
      try {
        await markProductRefreshFailed(supabase, product.id, {
          reason: `refreshEbayPrices failed: ${String(err)}`,
          productName: product.name,
          productSlug: product.slug,
        });
      } catch {
        // Freshness bookkeeping must never fail the product.
      }
    }
  }

  return result;
}

/**
 * One product: reserve budget, search (with retries on transient
 * failures), match, upsert. Returns 'budget-exhausted' /
 * 'not-configured' when the whole run must stop, otherwise the
 * per-product outcome (already counted into `result`).
 */
async function refreshOneProduct(
  supabase: AnySupabaseClient,
  searchFn: EbaySearchFn,
  ebayMerchantId: string,
  currencyIdByCode: Map<string, string>,
  product: {
    id: string;
    name: string;
    slug: string;
    brand: string | null;
    refresh_priority: number;
  },
  result: EbayRefreshResult,
  noRetryDelay: boolean
): Promise<EbayProductOutcome | 'budget-exhausted' | 'not-configured'> {
  const push = (
    outcome: EbayProductOutcome,
    price?: number,
    currency?: string
  ): EbayProductOutcome => {
    result.products.push({
      productId: product.id,
      slug: product.slug,
      outcome,
      ...(price !== undefined ? { price } : {}),
      ...(currency ? { currency } : {}),
    });
    return outcome;
  };

  // Search cheapest-first for the product name. One call per
  // attempt; every attempt reserves from the daily budget first.
  let search: EbaySearchResult | null = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const budget = await reserveEbayDailyCall(supabase);
    if (!budget.allowed) {
      return 'budget-exhausted';
    }
    search = await searchFn(product.name, { limit: SEARCH_LIMIT });
    if (search.ok) break;
    if (search.reason === 'not-configured') return 'not-configured';
    // Transient only: 429 / 5xx surface as 'rate-limited' /
    // 'api-error'. Retry twice, then treat the product as failed.
    if (attempt < MAX_ATTEMPTS - 1) {
      const delay = RETRY_DELAYS_MS[attempt] ?? 1000;
      if (!noRetryDelay) await sleep(delay);
      continue;
    }
  }
  if (!search || !search.ok) {
    result.failed += 1;
    // Section 20, §12 #53 — a failed live fetch after all
    // retries is a server error: it belongs in error_log.
    logApiError(
      new Error(
        `eBay search failed (${search ? search.reason : 'no result'}) after ${MAX_ATTEMPTS} attempts`
      ),
      { route: 'ebay-refresh', status: 502, context: { productId: product.id } }
    );
    try {
      await markProductRefreshFailed(supabase, product.id, {
        reason: search
          ? `eBay search failed (${search.reason}) after ${MAX_ATTEMPTS} attempts`
          : 'eBay search failed (no result)',
        productName: product.name,
        productSlug: product.slug,
      });
    } catch {
      // Freshness bookkeeping must never fail the product.
    }
    return push('failed');
  }

  if (search.listings.length === 0) {
    result.skippedNoListing += 1;
    return push('skipped-no-listing');
  }

  const match = search.listings.find(
    (l) =>
      l.price !== null &&
      ebayListingMatchesProduct(product.name, product.brand, l.title)
  );
  if (!match) {
    result.skippedMismatch += 1;
    return push('skipped-mismatch');
  }

  const currency = (match.currency ?? 'USD').toUpperCase();
  const currencyId = currencyIdByCode.get(currency);
  if (!currencyId) {
    result.skippedUnknownCurrency += 1;
    logger.warn('refreshEbayPrices: unknown currency on eBay listing', {
      productId: product.id,
      currency,
    });
    return push('skipped-unknown-currency');
  }

  const price = match.price as number;
  const nowIso = new Date().toISOString();

  // One eBay row per product: the latest live check wins. NO
  // price_history row is written here — a single snapshot of an
  // ephemeral asking price is not a history.
  const { data: existing } = await supabase
    .from('merchant_products')
    .select('id')
    .eq('product_id', product.id)
    .eq('merchant_id', ebayMerchantId)
    .maybeSingle();

  if (existing) {
    // Section 20, §12 #25 — the live check stamps the 045
    // verification columns; the 42703 retry keeps the row
    // writable while migration 045 is unapplied.
    const { error } = await writeEbayMerchantRow(async (withStamp) => {
      const patch: Record<string, unknown> = {
        price,
        currency_id: currencyId,
        url: match.itemWebUrl,
        merchant_sku: match.itemId,
        availability: 'in_stock',
        in_stock: true,
        updated_at: nowIso,
        ...(withStamp ? ebayVerificationStamp(nowIso) : {}),
      };
      const res = await supabase
        .from('merchant_products')
        .update(patch)
        .eq('id', (existing as { id: string }).id);
      return { error: res.error as { code?: string; message: string } | null };
    });
    if (error) {
      result.failed += 1;
      logger.warn('refreshEbayPrices: merchant_products update failed', {
        productId: product.id,
        error: error.message,
      });
      // Section 20, §12 #53 — a failed DB write is a server error.
      logApiError(new Error(`merchant_products update failed: ${error.message}`), {
        route: 'ebay-refresh',
        status: 500,
        context: { productId: product.id, operation: 'update' },
      });
      try {
        await markProductRefreshFailed(supabase, product.id, {
          reason: `merchant_products update failed: ${error.message}`,
          productName: product.name,
          productSlug: product.slug,
        });
      } catch {
        // Freshness bookkeeping must never fail the product.
      }
      return push('failed');
    }
    result.updated += 1;
  } else {
    const { error } = await writeEbayMerchantRow(async (withStamp) => {
      const row: Record<string, unknown> = {
        product_id: product.id,
        merchant_id: ebayMerchantId,
        price,
        currency_id: currencyId,
        url: match.itemWebUrl,
        merchant_sku: match.itemId,
        availability: 'in_stock',
        in_stock: true,
        ...(withStamp ? ebayVerificationStamp(nowIso) : {}),
      };
      const res = await supabase.from('merchant_products').insert(row);
      return { error: res.error as { code?: string; message: string } | null };
    });
    if (error) {
      result.failed += 1;
      logger.warn('refreshEbayPrices: merchant_products insert failed', {
        productId: product.id,
        error: error.message,
      });
      // Section 20, §12 #53 — a failed DB write is a server error.
      logApiError(new Error(`merchant_products insert failed: ${error.message}`), {
        route: 'ebay-refresh',
        status: 500,
        context: { productId: product.id, operation: 'insert' },
      });
      try {
        await markProductRefreshFailed(supabase, product.id, {
          reason: `merchant_products insert failed: ${error.message}`,
          productName: product.name,
          productSlug: product.slug,
        });
      } catch {
        // Freshness bookkeeping must never fail the product.
      }
      return push('failed');
    }
    result.inserted += 1;
  }

  // P1-10: the live check stamps data_freshness + next_refresh_at
  // through the policy layer — this is what makes the "Live eBay
  // asking price, checked <timestamp>" label true.
  try {
    await markProductRefreshed(
      supabase,
      product.id,
      product.refresh_priority as RefreshPriority
    );
  } catch {
    // Freshness bookkeeping must never fail the product.
  }
  return push(existing ? 'updated' : 'inserted', price, currency);
}
