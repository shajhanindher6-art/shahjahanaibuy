/**
 * Section 17, Stage C item 17 — services/pipeline/ caller
 * investigation + the refresh-chain wiring decision.
 *
 * INVESTIGATION (verified by grep, 12 Nov 2026 — not assumed):
 *  - `services/pipeline/*` (validation, normalization, dedup,
 *    category-assignment, brand-detection, image-processing,
 *    ingestion) has exactly ONE live caller:
 *    `lib/workers/processors.ts` imports `ingestBatch` for the
 *    `product.fetch` processor. That processor runs only via the
 *    worker queue (`lib/workers/queue.ts`), which is reached only
 *    from admin POST /api/v1/data/refresh (enqueueJob) — the
 *    synchronous in-process queue, since BullMQ does not exist
 *    (audit §10 #1). `startWorkers()` / `startScheduledJobs()`
 *    have zero callers.
 *  - The price-refresh route (`app/api/v1/prices/refresh/route.ts`)
 *    does NOT call the pipeline: its step 1 is
 *    `refreshTrackedPrices` (services/price-refresh.ts), which
 *    re-reads `merchant_products` from the DB only.
 *  - `data_sources` IS read by code — `processors.ts` (`data.sync`
 *    placeholder, processed: 0) and `queue.ts`
 *    (`startScheduledJobs`, zero callers) — but no live path
 *    drives a sync from it.
 *  - The provider registry (`services/providers/registry.ts`)
 *    registers only ApifyProvider (fail-closed: vars unset by
 *    design) plus MockProvider outside production; CsvProvider
 *    is registered from CSV_SOURCE_URL (Section 20, §12 #58)
 *    and the Amazon/Best Buy adapters are registered as
 *    fail-closed scaffolding (Section 20, §12 #57); eBay lives
 *    OUTSIDE the registry (services/ebay-*). The seed creates zero
 *    `product_sources` rows.
 *
 * DECISION — do NOT wire the refresh chain to pipeline
 * INGESTION (`ingestProduct` / `ingestBatch`):
 *  - Ingestion creates/updates PRODUCTS from provider search
 *    results. A price refresh must re-fetch the price of a
 *    product that already exists — the wrong tool, and one that
 *    would create products as a side effect of a price check.
 *  - With no available provider and no `product_sources` rows,
 *    an ingestion-based step could do nothing real today; it
 *    would only add a step that always reports zero.
 *
 * DECISION — the correct wiring point is the existing
 * `price.refresh` PROCESSOR (`lib/workers/processors.ts`):
 *  it resolves a product's `product_sources` rows, re-fetches
 *  each through the registered provider (`provider.fetch`), and
 *  records a new `price_history` row. That is exactly the live
 *  re-fetch the refresh chain is missing. This module wraps it
 *  per due product so the refresh route can call ONE function.
 *
 * WIRING POINT — the later worker adds this to
 * `app/api/v1/prices/refresh/route.ts` (this file does NOT edit
 * that route). After the `ebay` step, before the `refresh` step:
 *
 *   const zeroPipeline: PipelineRefreshResult = {
 *     available: false, reason: 'no-available-provider',
 *     checked: 0, refreshed: 0, failed: 0, errors: [],
 *   };
 *   const pipeline = await runRefreshStep(
 *     'refreshPricesViaPipeline',
 *     () => refreshPricesViaPipeline(supabase),
 *     zeroPipeline,
 *     (r) => (r.available ? null : null),
 *   );
 *
 *   …and add `pipeline: summarizeStep(pipeline)` to the `steps`
 *   record plus `'pipeline'` to the `stepNames` skip-list.
 *   The isFailed predicate stays null: `available: false` is an
 *   honest skip (no provider / no sources), not a failure — the
 *   run must not report `completed_with_failures` just because
 *   no live merchant adapter is configured yet. Per-product
 *   failures land in `result.failed` + `result.errors` and the
 *   step's counts stay visible in the response.
 *
 *   NOTE on clients: the `supabase` passed in is used ONLY to
 *   select due products. The per-product re-fetch runs inside
 *   `processors['price.refresh']`, which builds its OWN
 *   service-role client from env (see processors.ts
 *   `getServiceClient`) — the refresh route already requires
 *   SUPABASE_SERVICE_ROLE_KEY, so no new credential is needed.
 *   NOTE on bounds: at most 100 due products per run, ordered
 *   by `next_refresh_at` ascending (most overdue first).
 */

import type { AnySupabaseClient } from '@/lib/supabase/types';
import { getProviderRegistry } from '@/services/providers';
import { processors } from '@/lib/workers/processors';
import { logger } from '@/lib/config/logger';
import { logApiError } from '@/lib/api/error-logging';
import { markProductRefreshed } from '@/services/freshness';
import { markProductVerified } from '@/services/price-verification';
import { PUBLISHED_PRODUCT_STATUS } from '@/services/price-verification';
import type { JobDefinition } from '@/lib/workers/types';

export interface PipelineRefreshResult {
  /**
   * False when the step could not run at all — no provider is
   * available, the registry is unreachable, or the due-products
   * select failed. `checked`/`refreshed`/`failed` are then 0
   * and `reason` says why; the step is a skip, never a crash.
   */
  available: boolean;
  reason?: string;
  /** Due products the step attempted (0 when unavailable). */
  checked: number;
  /** Products with at least one fresh price point recorded. */
  refreshed: number;
  /** Products whose re-fetch failed (see `errors`). */
  failed: number;
  /** One line per failed product (never a price, never a secret). */
  errors: string[];
}

/** Hard cap per refresh run — the chain stays bounded and free-tier friendly. */
export const PIPELINE_REFRESH_BATCH_LIMIT = 100;

const UNAVAILABLE = (
  reason: string,
  errors: string[] = []
): PipelineRefreshResult => ({
  available: false,
  reason,
  checked: 0,
  refreshed: 0,
  failed: 0,
  errors,
});

/**
 * Re-fetch prices for due products through the provider
 * registry's `price.refresh` processor.
 *
 * Due = `next_refresh_at` in the past, not soft-deleted,
 * published. Never throws: every failure mode returns a
 * result (available: false + reason, or per-product errors).
 * A product with no `product_sources` rows fails honestly
 * ("No product sources found for product") — the processor
 * cannot invent a source to fetch from.
 */
export async function refreshPricesViaPipeline(
  supabase: AnySupabaseClient,
  options: { limit?: number } = {}
): Promise<PipelineRefreshResult> {
  const limit = Math.min(
    PIPELINE_REFRESH_BATCH_LIMIT,
    Math.max(1, options.limit ?? PIPELINE_REFRESH_BATCH_LIMIT)
  );

  let registry;
  try {
    registry = getProviderRegistry();
  } catch (err) {
    // Section 20, §12 #53 — a registry that cannot even be built
    // is a server error: it belongs in error_log.
    logApiError(err, {
      route: 'pipeline-refresh',
      status: 500,
      context: { reason: 'registry-unavailable' },
    });
    return UNAVAILABLE('registry-unavailable', [String(err)]);
  }
  if (registry.getAvailable().length === 0) {
    // Sections 21–25, Stage B (B2) — the one function that
    // explains WHY a provider is not configured is wired in
    // here: the unavailable reason names every registered
    // provider's reason, so the refresh run record says why
    // nothing could be fetched instead of just "no provider".
    const reasons = registry
      .getAll()
      .map((p) => `${p.name}: ${p.getNotConfiguredReason() ?? 'available'}`)
      .join(' | ');
    return UNAVAILABLE(
      'no-available-provider',
      [
        'No provider is available (CsvProvider needs CSV_SOURCE_URL; Amazon/Best Buy need their keys; Apify is fail-closed without its vars; Mock is never registered in production; eBay lives outside the registry).',
        reasons,
      ]
    );
  }

  // Due products, most overdue first. The status filter retries
  // without itself on 42703 (migration 045 unapplied); a
  // next_refresh_at failure (migration 004 unapplied) is a
  // load failure, not an empty due set.
  const now = new Date().toISOString();
  const buildDueQuery = (withStatus: boolean) => {
    let query = supabase
      .from('products')
      .select('id, slug, next_refresh_at')
      .is('deleted_at', null)
      .lte('next_refresh_at', now)
      .order('next_refresh_at', { ascending: true })
      .limit(limit);
    if (withStatus) query = query.eq('status', PUBLISHED_PRODUCT_STATUS);
    return query;
  };
  let { data: due, error: dueError } = await buildDueQuery(true);
  if (dueError && (dueError as { code?: string }).code === '42703') {
    ({ data: due, error: dueError } = await buildDueQuery(false));
  }
  if (dueError || !due) {
    logger.warn('refreshPricesViaPipeline: due-products query failed', {
      error: dueError?.message,
    });
    // Section 20, §12 #53 — a failed due-products read is a
    // server error: it belongs in error_log.
    logApiError(
      new Error(`due-products query failed: ${dueError?.message ?? 'no rows returned'}`),
      { route: 'pipeline-refresh', status: 500, context: { reason: 'due-products-unreadable' } }
    );
    return UNAVAILABLE('due-products-unreadable', [
      dueError?.message ?? 'due-products query returned no rows',
    ]);
  }

  const productIds = (due as Array<{ id: string }>).map((r) => r.id).filter(Boolean);
  if (productIds.length === 0) {
    return { available: true, checked: 0, refreshed: 0, failed: 0, errors: [] };
  }

  const processor = processors['price.refresh'];
  const result: PipelineRefreshResult = {
    available: true,
    checked: 0,
    refreshed: 0,
    failed: 0,
    errors: [],
  };

  for (const productId of productIds) {
    result.checked++;
    try {
      const job: JobDefinition = {
        type: 'price.refresh',
        data: { productId },
      };
      const jobResult = await processor(job);
      if (jobResult.success && jobResult.processed > 0) {
        result.refreshed++;
        // Section 20, §12 #43 — this leg IS a live check: the
        // processor re-fetched the price from the product's
        // provider and recorded a fresh point, so the freshness
        // stamp moves here. Contrast services/price-refresh.ts,
        // which only re-reads the database and must NOT stamp.
        // Best-effort: a stamp failure never fails the product.
        try {
          await markProductRefreshed(supabase, productId);
        } catch {
          // Freshness bookkeeping must never fail the product.
        }
        // FINAL 100% (F-P0-02): the same live check re-verifies
        // the PRODUCTS rollup — the processor saved a validated
        // provider response, so the product itself is 'verified'
        // as of this run (source 'merchant-feed'). The stamp time
        // is now: the fetch happened moments ago inside the
        // processor call above. Best-effort, like the freshness
        // stamp; 045 unapplied reports columnsMissing.
        try {
          await markProductVerified(supabase, productId, {
            source: 'merchant-feed',
            verifiedAt: new Date().toISOString(),
          });
        } catch {
          // Verification bookkeeping must never fail the product.
        }
      } else {
        result.failed++;
        for (const e of jobResult.errors ?? ['price.refresh reported no fresh price']) {
          result.errors.push(`${productId}: ${e}`);
        }
      }
    } catch (err) {
      result.failed++;
      result.errors.push(`${productId}: ${String(err)}`);
    }
  }

  return result;
}
