/**
 * Post-Integration Verification & Real Data Phase — Best Buy
 * source-linking step (SERVER-ONLY).
 *
 * THE GAP THIS CLOSES: the Best Buy client exists and is
 * registered (services/providers/bestbuy-provider.ts, registry key
 * 'bestbuy', official_api, top priority) and the refresh chain
 * already has a pipeline re-fetch leg
 * (services/pipeline-refresh.ts → processors['price.refresh']),
 * but that leg can only re-fetch a product that HAS a
 * `product_sources` row — and the seed creates ZERO such rows.
 * Until a product is linked to its Best Buy SKU, the key landing
 * still leaves `pipeline.refreshed = 0` for Best Buy. This step
 * is the link: for each published product with no Best Buy
 * source, it searches Best Buy (UPC → model → keyword) and, on
 * an auto-match, upserts the `product_sources` row (retailer
 * 'best-buy', external_id = SKU, provider_key 'bestbuy'). The
 * NEXT refresh then fetches the live price through the existing
 * pipeline leg.
 *
 * MATCHING IS SCORED, NEVER GUESSED: candidates are scored with
 * the SAME matcher as eBay (services/ebay-matching.ts —
 * `scoreEbayListingMatchWithModel`, 0.85 auto threshold, GTIN /
 * model vetoes, accessory-word and model-year vetoes). A Best Buy
 * candidate carries structured fields (name, manufacturer,
 * modelNumber, GS1-validated UPC), so the matcher sees a real
 * listing-side model and GTIN — the strongest form of the match.
 * Below the threshold the product is `skipped-review` (never
 * linked); a vetoed candidate never links. On ANY doubt the
 * product is SKIPPED — a wrong-SKU link would fetch the wrong
 * product's price on every later refresh.
 *
 * WHAT THIS STEP DOES NOT DO (deliberately):
 *   - It creates NO products and writes NO prices, NO
 *     price_history rows, NO specs/images/GTIN onto the product
 *     row. Enrichment is the ingestion path's job
 *     (services/pipeline/ingestion.ts) once the source exists;
 *     this step only links.
 *   - It does NOT count toward `livePricesFetched`: linking is
 *     not a live price fetch. The pipeline leg fetches the price
 *     on the next run, once the source exists.
 *
 * FAIL-CLOSED, IDEMPOTENT, BOUNDED:
 *   - No key → `status: 'not-configured'`, nothing searched,
 *     nothing linked. The key comes only from BESTBUY_API_KEY in
 *     the hosting dashboard (never logged — the client never logs
 *     request URLs, which carry the key).
 *   - No `retailers` row with slug 'best-buy' → status
 *     'retailer-missing' (merchants/retailers are NEVER
 *     auto-created — the eBay pattern).
 *   - Already-linked products are skipped without spending
 *     budget. One budget unit is reserved per Best Buy call
 *     (services/provider-budget.ts, bestbuy 50,000/day); at the
 *     cap the run stops with 'budget-exhausted'.
 *   - `last_fetched_at` on a link-only row is NULL (migration
 *     073 makes the column nullable): a link is not a fetch, and
 *     stamping "now" would claim a fetch happened. Until 073 is
 *     applied the column is NOT NULL, so the upsert retries once
 *     with the link time and reports `fetchTimestampAssumed: true`
 *     on the product result — the assumption is named, never
 *     silent. The processor overwrites the stamp on the first
 *     real fetch either way.
 *   - The step never throws: an unexpected failure returns
 *     `status: 'unavailable'` and the refresh route degrades.
 *
 * WIRING (parent: add to app/api/v1/prices/refresh/route.ts,
 * after the `pipeline` step, before `buildRefreshSharedReads`):
 *
 *   const zeroBestBuySources: BestBuySourceLinkResult = {
 *     status: 'ok', checked: 0, linked: 0, alreadyLinked: 0,
 *     skippedNoMatch: 0, skippedReview: 0, failed: 0,
 *     budgetExhausted: false, products: [],
 *   };
 *   let bestbuySources = await runRefreshStep(
 *     'linkBestBuySources',
 *     () => linkBestBuySources(supabase),
 *     zeroBestBuySources
 *   );
 *
 *   …and add `bestbuySources: summarizeStep(bestbuySources)` to
 *   the `steps` record, `'linkBestBuySources'` to `stepNames`,
 *   and a `case 'linkBestBuySources'` to the rerun switch.
 *   Linking must NOT add to `livePricesFetched`.
 */

import type { AnySupabaseClient } from '@/lib/supabase/types';
import { logger } from '@/lib/config/logger';
import { logApiError } from '@/lib/api/error-logging';
import { validateGtin } from '@/lib/gtin';
import { BestBuyProvider } from './providers/bestbuy-provider';
import type { RawProductData } from './providers/types';
import { ProviderBudgetExhaustedError } from './providers/errors';
import { checkProviderBudget } from './provider-budget';
import {
  scoreEbayListingMatchWithModel,
  EBAY_MATCH_AUTO_THRESHOLD,
} from './ebay-matching';
import { PUBLISHED_PRODUCT_STATUS } from './price-verification';

export type BestBuySourceLinkStatus =
  | 'ok'
  | 'not-configured'
  | 'retailer-missing'
  | 'budget-exhausted'
  | 'unavailable';

export type BestBuySourceLinkOutcome =
  | 'linked'
  | 'already-linked'
  | 'skipped-no-match'
  | 'skipped-review'
  | 'failed';

export interface BestBuySourceLinkProductResult {
  productId: string;
  slug: string;
  outcome: BestBuySourceLinkOutcome;
  /** Best Buy SKU the product was linked to (linked only). */
  sku?: string;
  /** Scored match behind the outcome (0–1), or null when nothing was scored. */
  matchConfidence?: number | null;
  /** Which leg carried the match ('gtin' | 'model' | 'name-brand' | ...). */
  matchedBy?: string | null;
  /** True when the best candidate scored below the auto threshold and needs manual review. */
  matchReviewRequired?: boolean;
  /**
   * True when migration 073 is unapplied and the link row's
   * `last_fetched_at` had to be stamped with the link time
   * instead of NULL — the stamp is a link time, not a fetch
   * time. Absent (undefined) when the NULL write succeeded.
   */
  fetchTimestampAssumed?: boolean;
}

export interface BestBuySourceLinkResult {
  status: BestBuySourceLinkStatus;
  checked: number;
  linked: number;
  alreadyLinked: number;
  skippedNoMatch: number;
  skippedReview: number;
  failed: number;
  budgetExhausted: boolean;
  error?: string;
  products: BestBuySourceLinkProductResult[];
}

/**
 * The provider surface this step needs. BestBuyProvider
 * satisfies it structurally; tests pass a fake. Only the
 * search methods are used — never `fetch` (this step links,
 * it does not fetch prices).
 */
export interface BestBuySourceSearch {
  isAvailable(): boolean;
  getNotConfiguredReason(): string | null;
  searchByUpc(upc: string, limit?: number): Promise<RawProductData[]>;
  searchByModel(modelNumber: string, limit?: number): Promise<RawProductData[]>;
  search(request: { query: string; limit?: number }): Promise<RawProductData[]>;
}

/** Hard cap per run — the chain stays bounded and free-tier friendly. */
export const BESTBUY_SOURCE_LINK_BATCH_LIMIT = 10;
/** Candidates scored per product (Best Buy pageSize cap is 10; 5 is enough to rank). */
const SEARCH_LIMIT = 5;
/** Retailers slug for Best Buy (seed: 'best-buy'; provider key is 'bestbuy'). */
const BESTBUY_RETAILER_SLUG = 'best-buy';
const BESTBUY_PROVIDER_KEY = 'bestbuy';

const ZERO_RESULT: BestBuySourceLinkResult = {
  status: 'ok',
  checked: 0,
  linked: 0,
  alreadyLinked: 0,
  skippedNoMatch: 0,
  skippedReview: 0,
  failed: 0,
  budgetExhausted: false,
  products: [],
};

/** True when the error means "column cannot be null" (Postgres 23502). */
function isNotNullViolation(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === '23502';
}

/** True when the error means "column does not exist" (Postgres 42703). */
function isUndefinedColumnError(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === '42703';
}

export async function linkBestBuySources(
  supabase: AnySupabaseClient,
  options?: {
    /** Test-only provider override; production uses the real BestBuyProvider. */
    provider?: BestBuySourceSearch;
    /** Test-only product cap; production uses the batch limit. */
    limit?: number;
  }
): Promise<BestBuySourceLinkResult> {
  const result: BestBuySourceLinkResult = { ...ZERO_RESULT, products: [] };
  try {
    return await linkBestBuySourcesInner(supabase, result, options);
  } catch (err) {
    // The step never throws: an unexpected failure degrades the
    // run instead of failing it.
    logger.warn('linkBestBuySources: unexpected failure', { error: String(err) });
    logApiError(err, { route: 'bestbuy-source-link', status: 500 });
    result.status = 'unavailable';
    result.error = err instanceof Error ? err.message : String(err);
    return result;
  }
}

async function linkBestBuySourcesInner(
  supabase: AnySupabaseClient,
  result: BestBuySourceLinkResult,
  options?: {
    provider?: BestBuySourceSearch;
    limit?: number;
  }
): Promise<BestBuySourceLinkResult> {
  const provider: BestBuySourceSearch = options?.provider ?? new BestBuyProvider();
  if (!provider.isAvailable()) {
    result.status = 'not-configured';
    result.error =
      'Best Buy is not configured (BESTBUY_API_KEY missing) — no search ran, nothing linked';
    return result;
  }

  // The Best Buy `retailers` row must exist first (seed carries
  // slug 'best-buy'). Never auto-create it — fail honestly.
  const { data: retailer, error: retailerError } = await supabase
    .from('retailers')
    .select('id, slug')
    .eq('slug', BESTBUY_RETAILER_SLUG)
    .maybeSingle();
  if (retailerError || !retailer) {
    result.status = 'retailer-missing';
    result.error =
      "Best Buy retailers row is missing (slug 'best-buy') — the owner must create it via SQL; retailers are never auto-created";
    logger.warn('linkBestBuySources: Best Buy retailers row missing', {
      error: retailerError?.message,
    });
    return result;
  }
  const bestbuyRetailerId = (retailer as { id: string }).id;

  const limit = Math.min(
    Math.max(1, options?.limit ?? BESTBUY_SOURCE_LINK_BATCH_LIMIT),
    BESTBUY_SOURCE_LINK_BATCH_LIMIT
  );

  // Published, not-deleted products, slug order (deterministic
  // window: linked products are skipped, so the window advances
  // as links land). The status filter retries without itself on
  // 42703 (migration 045 unapplied).
  const buildProductsQuery = (withStatus: boolean) => {
    let query = supabase
      .from('products')
      .select('id, slug, name, brand, gtin')
      .is('deleted_at', null)
      .order('slug', { ascending: true })
      .limit(limit);
    if (withStatus) query = query.eq('status', PUBLISHED_PRODUCT_STATUS);
    return query;
  };
  let { data: productRows, error: productError } = await buildProductsQuery(true);
  if (productError && isUndefinedColumnError(productError)) {
    ({ data: productRows, error: productError } = await buildProductsQuery(false));
  }
  if (productError || !productRows) {
    result.status = 'unavailable';
    result.error = `Could not load products: ${productError?.message ?? 'no rows returned'}`;
    return result;
  }

  // Model numbers, best-effort in one read (migration 055
  // unapplied → no model leg, never a failed run).
  const modelById = new Map<string, string | null>();
  try {
    const { data: modelRows, error: modelError } = await supabase
      .from('products')
      .select('id, model_number')
      .in(
        'id',
        (productRows as Array<{ id: string }>).map((p) => p.id)
      );
    if (!modelError && modelRows) {
      for (const row of modelRows as Array<{ id: string; model_number: string | null }>) {
        modelById.set(row.id, row.model_number);
      }
    }
  } catch {
    // Best-effort only: matching proceeds without the model leg.
  }

  // Products already linked to Best Buy — one read, skipped
  // without spending budget.
  const { data: sourceRows } = await supabase
    .from('product_sources')
    .select('product_id')
    .eq('provider_key', BESTBUY_PROVIDER_KEY)
    .limit(1000);
  const linkedProductIds = new Set(
    ((sourceRows ?? []) as Array<{ product_id: string }>).map((r) => r.product_id)
  );

  for (const product of productRows as Array<{
    id: string;
    slug: string;
    name: string;
    brand: string | null;
    gtin: string | null;
  }>) {
    result.checked += 1;
    const productWithModel = {
      ...product,
      modelNumber: modelById.get(product.id) ?? null,
    };
    if (linkedProductIds.has(product.id)) {
      result.alreadyLinked += 1;
      result.products.push({
        productId: product.id,
        slug: product.slug,
        outcome: 'already-linked',
      });
      continue;
    }
    try {
      const outcome = await linkOneProduct(
        supabase,
        provider,
        bestbuyRetailerId,
        productWithModel,
        result
      );
      if (outcome === 'budget-exhausted') {
        result.budgetExhausted = true;
        result.status = 'budget-exhausted';
        break;
      }
      if (outcome === 'not-configured') {
        result.status = 'not-configured';
        result.error = 'Best Buy became unconfigured mid-run (key removed?) — stopped';
        break;
      }
    } catch (err) {
      logger.warn('linkBestBuySources: product failed', {
        productId: product.id,
        error: String(err),
      });
      result.failed += 1;
      result.products.push({
        productId: product.id,
        slug: product.slug,
        outcome: 'failed',
      });
    }
  }

  return result;
}

/**
 * One product: search (UPC → model → keyword, first non-empty
 * list wins), score, link on auto. Returns 'budget-exhausted' /
 * 'not-configured' when the whole run must stop, otherwise the
 * per-product outcome (already counted into `result`).
 */
async function linkOneProduct(
  supabase: AnySupabaseClient,
  provider: BestBuySourceSearch,
  bestbuyRetailerId: string,
  product: {
    id: string;
    slug: string;
    name: string;
    brand: string | null;
    gtin: string | null;
    modelNumber: string | null;
  },
  result: BestBuySourceLinkResult
): Promise<BestBuySourceLinkOutcome | 'budget-exhausted' | 'not-configured'> {
  const push = (
    outcome: BestBuySourceLinkOutcome,
    extra?: Partial<
      Pick<
        BestBuySourceLinkProductResult,
        'sku' | 'matchConfidence' | 'matchedBy' | 'matchReviewRequired' | 'fetchTimestampAssumed'
      >
    >
  ): BestBuySourceLinkOutcome => {
    result.products.push({
      productId: product.id,
      slug: product.slug,
      outcome,
      ...(extra ?? {}),
    });
    return outcome;
  };

  // Search legs, in strength order. Each leg reserves one budget
  // unit first (provider-budget.ts, bestbuy 50,000/day); at the
  // cap the run stops. A leg that returns rows ends the search —
  // a weaker leg must never outrank a stronger leg's candidates.
  let candidates: RawProductData[] = [];
  const gtinCheck = product.gtin ? validateGtin(product.gtin) : null;
  const legs: Array<() => Promise<RawProductData[]>> = [];
  if (gtinCheck?.valid && gtinCheck.normalized) {
    const upc = gtinCheck.normalized;
    legs.push(() => provider.searchByUpc(upc, SEARCH_LIMIT));
  }
  if (product.modelNumber && product.modelNumber.trim() !== '') {
    const model = product.modelNumber.trim();
    legs.push(() => provider.searchByModel(model, SEARCH_LIMIT));
  }
  legs.push(() => provider.search({ query: product.name, limit: SEARCH_LIMIT }));

  for (const leg of legs) {
    try {
      checkProviderBudget(BESTBUY_PROVIDER_KEY);
    } catch (err) {
      if (err instanceof ProviderBudgetExhaustedError) {
        return 'budget-exhausted';
      }
      throw err;
    }
    let rows: RawProductData[];
    try {
      rows = await leg();
    } catch (err) {
      // A missing key mid-run stops the run (same as eBay's
      // not-configured); any other provider error fails this
      // product only — the next product still gets its chance.
      if (
        (err as { name?: string })?.name === 'ProviderNotConfiguredError' ||
        String(err).includes('not configured')
      ) {
        return 'not-configured';
      }
      result.failed += 1;
      logger.warn('linkBestBuySources: search failed for product', {
        productId: product.id,
        error: String(err),
      });
      return push('failed');
    }
    if (rows.length > 0) {
      candidates = rows;
      break;
    }
  }

  if (candidates.length === 0) {
    result.skippedNoMatch += 1;
    return push('skipped-no-match');
  }

  // Score every candidate with the shared matcher (same
  // threshold, same vetoes as eBay). The best-scoring candidate
  // wins; below the auto threshold it is held for review.
  const scored = candidates
    .map((c) => ({
      candidate: c,
      score: scoreEbayListingMatchWithModel({
        productName: product.name,
        productBrand: product.brand,
        productModel: product.modelNumber,
        productGtin: product.gtin,
        listingTitle: c.name,
        listingGtin: c.gtin ?? null,
        listingModel: c.modelNumber ?? null,
      }),
    }))
    .sort((a, b) => (b.score.score ?? -1) - (a.score.score ?? -1));
  const best = scored[0];
  const matchInfo = best
    ? {
        matchConfidence: best.score.confidence,
        matchedBy: best.score.matchedBy,
        matchReviewRequired: best.score.decision === 'review',
      }
    : { matchConfidence: null, matchedBy: null, matchReviewRequired: false };
  if (!best || best.score.decision !== 'auto') {
    result.skippedReview += 1;
    if (best) {
      logger.warn('linkBestBuySources: best Best Buy candidate did not auto-match', {
        productId: product.id,
        decision: best.score.decision,
        score: best.score.score,
        reasons: best.score.reasons,
      });
    }
    return push('skipped-review', matchInfo);
  }

  const sku = best.candidate.externalId;
  // Link-only row: last_fetched_at is NULL until the first real
  // fetch (migration 073 makes the column nullable). Until 073
  // is applied the column is NOT NULL, so a 23502 retries once
  // with the link time — and the assumption is reported on the
  // product result, never silent.
  const upsertRow = (lastFetchedAt: string | null): Record<string, unknown> => ({
    product_id: product.id,
    retailer_id: bestbuyRetailerId,
    external_id: sku,
    provider_key: BESTBUY_PROVIDER_KEY,
    last_fetched_at: lastFetchedAt,
    raw: { sku },
  });
  const upsertOnce = async (
    lastFetchedAt: string | null
  ): Promise<{ error: { code?: string; message: string } | null }> => {
    const res = await supabase
      .from('product_sources')
      .upsert(upsertRow(lastFetchedAt), { onConflict: 'retailer_id,external_id' });
    return { error: (res as { error: { code?: string; message: string } | null }).error ?? null };
  };
  let assumed = false;
  let { error } = await upsertOnce(null);
  if (error && isNotNullViolation(error)) {
    assumed = true;
    ({ error } = await upsertOnce(new Date().toISOString()));
  }
  if (error) {
    result.failed += 1;
    logger.warn('linkBestBuySources: product_sources upsert failed', {
      productId: product.id,
      error: error.message,
    });
    logApiError(new Error(`product_sources upsert failed: ${error.message}`), {
      route: 'bestbuy-source-link',
      status: 500,
      context: { productId: product.id, operation: 'upsert' },
    });
    return push('failed');
  }

  result.linked += 1;
  return push('linked', {
    sku,
    ...matchInfo,
    ...(assumed ? { fetchTimestampAssumed: true } : {}),
  });
}

// Re-exported so callers and tests share the one threshold.
export { EBAY_MATCH_AUTO_THRESHOLD as BESTBUY_MATCH_AUTO_THRESHOLD };
