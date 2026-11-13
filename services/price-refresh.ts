/**
 * Price refresh worker — the missing "scraper" leg of price alerts.
 *
 * Until now, POST /api/v1/alerts/check could only compare alerts with
 * price_history rows that already existed. If no new price row ever
 * arrived, a real price drop could never be noticed, no matter how
 * often the checker ran. This service closes that gap — without
 * scraping retailer websites directly and without inventing prices:
 *
 *   1. Collect the products users actually care about: distinct
 *      product_ids from active alerts + wishlist_items. Untouched
 *      catalog products are deliberately NOT refreshed, so a
 *      scheduled run stays bounded and free-tier friendly.
 *   2. For each, take the lowest in-stock merchant_products row —
 *      that is the catalog's current known price, as last synced by
 *      the existing provider pipeline (Apify / CSV / merchant upload).
 *      Live retailer scraping itself still belongs to that pipeline
 *      and still needs its provider keys; this worker does not add a
 *      second, unauthenticated scraper.
 *   3. Map the merchant to a retailer by slug. merchants and
 *      retailers are separate tables with the same slugs (see the
 *      seed comment in supabase/seed-demo-data.sql); price_history
 *      references retailers, so a merchant with no matching retailer
 *      slug is SKIPPED, never recorded against a wrong retailer.
 *   4. Append a price_history row ONLY when the price or availability
 *      differs from that product+retailer's latest row. Unchanged
 *      prices create no rows, so the trend graph never shows fake
 *      fluctuations from a scheduled run re-recording the same price.
 *
 * After this runs, the existing alert checker sees the new row and
 * fires, and notification-dispatch sends the Resend email — so the
 * full chain is: refresh -> check -> Resend, in one scheduled call
 * (see app/api/v1/prices/refresh/route.ts). Must run with the
 * service-role client: it reads alerts and wishlist_items across all
 * users, which owner-scoped RLS would hide from an anon client.
 */

import type { AnySupabaseClient } from '@/lib/supabase/types';
import { logger } from '@/lib/config/logger';
import { invalidateAiForProduct } from '@/lib/cache/ai-invalidation';
import {
  markProductRefreshed,
  markProductRefreshFailed,
} from './freshness';

export interface PriceRefreshResult {
  tracked: number;
  inserted: number;
  unchanged: number;
  skippedNoRetailer: number;
  skippedNoPrice: number;
  failed: number;
  /**
   * Section 15, P1-8: true when a source LOAD failed (alerts /
   * wishlist / merchant_products / price_history select returned an
   * error). The step must be reported as failed, never as a silent
   * `tracked: 0` success — a failed load means the tracked set is
   * unknown, not empty. `loadError` carries the first such error.
   * Per-row failures still land in `failed` and do NOT set this.
   */
  loadFailed: boolean;
  loadError?: string;
}

interface MerchantProductRow {
  product_id: string;
  merchant_id: string;
  price: number | string;
  availability: string | null;
  url: string | null;
  in_stock: boolean;
}

export interface PriceHistorySharedRow {
  product_id: string;
  retailer_id: string;
  price: number | string;
  availability: string;
  recorded_at: string;
}

/**
 * Section 18, item 31 — the rows the three refresh steps used to
 * read independently, fetched ONCE per run and passed down:
 *
 *   - `refreshTrackedPrices` (this file) read merchant_products +
 *     price_history for the alerts+wishlist set;
 *   - `recordAvailabilitySnapshots` (prices/refresh route) read
 *     merchant_products again for the alerts+wishlist+guest set;
 *   - `checkGuestEmailAlerts` (same route) read price_history
 *     again for the guest-alert set.
 *
 * The builder reads the tracked sets (alerts + wishlist + active
 * guest alerts, each limit 1000 — exactly the steps' own queries),
 * then ONE merchant_products read (no `in_stock` filter — the
 * refresh step filters in JS) and ONE price_history read
 * (`.limit(1000)`, newest first — the refresh step's exact shape;
 * the guest step's columns are a subset of it, same order, so
 * first-wins per product is identical).
 *
 * Returns null — and every step falls back to its own reads, with
 * its own load-failure behaviour exactly as before — when:
 *   - ANY tracked-set / merchant / history read errors or throws
 *     (a failed load must never silently become "no products");
 *   - the union exceeds SHARED_TRACKED_CAP (500): the steps' own
 *     500-capped slices would differ, so sharing would change
 *     which products each step sees.
 *
 * Truncation note: like each step's own read, the shared history
 * read is capped at 1000 rows, so in a catalog whose union has
 * >1000 history rows the newest-rows window is the union's, not
 * each step's own. The step still reports honestly what it did
 * (an insert instead of `unchanged` for a product whose latest row
 * fell outside the window) — the same class of behaviour the
 * per-step 1000 cap already had.
 */
export interface RefreshSharedReads {
  /** Alerts + wishlist product ids (the refresh step's own set), capped at 500. */
  refreshIds: string[];
  /** Alerts + wishlist + active guest alerts (the stock step's set), capped at 500. */
  stockIds: string[];
  /** Active guest-alert product ids. */
  guestProductIds: string[];
  /** merchant_products rows for stockIds — NO in_stock filter. */
  merchantRows: MerchantProductRow[];
  /** price_history rows for stockIds, newest first, limit 1000. */
  historyRows: PriceHistorySharedRow[];
}

const SHARED_TRACKED_CAP = 500;

export async function buildRefreshSharedReads(
  supabase: AnySupabaseClient
): Promise<RefreshSharedReads | null> {
  try {
    const alertIds = new Set<string>();
    const wishlistIds = new Set<string>();
    const guestIds = new Set<string>();

    const { data: alertRows, error: alertError } = await supabase
      .from('alerts')
      .select('product_id')
      .eq('active', true)
      .limit(1000);
    if (alertError) return null;
    for (const row of (alertRows ?? []) as Array<{ product_id: string }>) {
      if (row.product_id) alertIds.add(row.product_id);
    }

    const { data: wishlistRows, error: wishlistError } = await supabase
      .from('wishlist_items')
      .select('product_id')
      .limit(1000);
    if (wishlistError) return null;
    for (const row of (wishlistRows ?? []) as Array<{ product_id: string }>) {
      if (row.product_id) wishlistIds.add(row.product_id);
    }

    const { data: guestRows, error: guestError } = await supabase
      .from('guest_email_alerts')
      .select('product_id')
      .eq('active', true)
      .limit(1000);
    if (guestError) return null;
    for (const row of (guestRows ?? []) as Array<{ product_id: string }>) {
      if (row.product_id) guestIds.add(row.product_id);
    }

    const refreshIds = Array.from(new Set([...alertIds, ...wishlistIds])).slice(0, SHARED_TRACKED_CAP);
    const stockIds = Array.from(new Set([...alertIds, ...wishlistIds, ...guestIds]));
    // Above the cap the steps' own 500-slices differ — do not share.
    if (stockIds.length > SHARED_TRACKED_CAP) return null;
    const stockIdsCapped = stockIds.slice(0, SHARED_TRACKED_CAP);
    if (stockIdsCapped.length === 0) {
      return { refreshIds: [], stockIds: [], guestProductIds: [], merchantRows: [], historyRows: [] };
    }

    const { data: merchantRows, error: merchantError } = await supabase
      .from('merchant_products')
      .select('product_id, merchant_id, price, availability, url, in_stock')
      .in('product_id', stockIdsCapped)
      .is('deleted_at', null)
      .order('price', { ascending: true });
    if (merchantError || !merchantRows) return null;

    const { data: historyRows, error: historyError } = await supabase
      .from('price_history')
      .select('product_id, retailer_id, price, availability, recorded_at')
      .in('product_id', stockIdsCapped)
      .order('recorded_at', { ascending: false })
      .limit(1000);
    if (historyError) return null;

    return {
      refreshIds,
      stockIds: stockIdsCapped,
      guestProductIds: Array.from(guestIds),
      merchantRows: merchantRows as MerchantProductRow[],
      historyRows: (historyRows ?? []) as PriceHistorySharedRow[],
    };
  } catch {
    // Any throw (transport failure, missing table) → no sharing.
    return null;
  }
}

export async function refreshTrackedPrices(
  supabase: AnySupabaseClient,
  /** Section 18, item 31 — the run's shared reads (see
   *  buildRefreshSharedReads). When provided, the tracked-set,
   *  merchant_products and price_history reads below are skipped
   *  and the shared rows are filtered in JS. When null/omitted
   *  the step reads everything itself, exactly as before. */
  shared?: RefreshSharedReads | null
): Promise<PriceRefreshResult> {
  const result: PriceRefreshResult = {
    tracked: 0,
    inserted: 0,
    unchanged: 0,
    skippedNoRetailer: 0,
    skippedNoPrice: 0,
    failed: 0,
    loadFailed: false,
  };

  const productIds = new Set<string>();

  // Section 15, P1-8: a failed select used to destructure `{ data }`
  // and silently treat it as "no alerts / no wishlist" — `tracked: 0`
  // + 200 "success". Check `error` now: a failed load marks the
  // whole step failed, but a load that DID succeed still contributes
  // its products, so one broken table cannot hide the other.
  // Section 18, item 31 — with shared reads the tracked set comes
  // from the builder (which already failed the share on any read
  // error, so no load failure can hide here).
  if (shared) {
    for (const id of shared.refreshIds) productIds.add(id);
  } else {
    const { data: alertRows, error: alertError } = await supabase
      .from('alerts')
      .select('product_id')
      .eq('active', true)
      .limit(1000);
    if (alertError) {
      logger.warn('refreshTrackedPrices: alerts query failed', {
        error: alertError.message,
      });
      result.loadFailed = true;
      result.loadError = `alerts: ${alertError.message}`;
    } else {
      for (const row of (alertRows ?? []) as Array<{ product_id: string }>) {
        if (row.product_id) productIds.add(row.product_id);
      }
    }

    const { data: wishlistRows, error: wishlistError } = await supabase
      .from('wishlist_items')
      .select('product_id')
      .limit(1000);
    if (wishlistError) {
      logger.warn('refreshTrackedPrices: wishlist query failed', {
        error: wishlistError.message,
      });
      result.loadFailed = true;
      result.loadError =
        result.loadError ?? `wishlist_items: ${wishlistError.message}`;
    } else {
      for (const row of (wishlistRows ?? []) as Array<{ product_id: string }>) {
        if (row.product_id) productIds.add(row.product_id);
      }
    }
  }

  const ids = Array.from(productIds).slice(0, 500);
  result.tracked = ids.length;
  if (ids.length === 0) return result;

  // Lowest in-stock merchant listing per product.
  // Section 18, item 31 — with shared reads the merchant rows are
  // the builder's (no `in_stock` filter on the query); the filter
  // happens here in JS, on the same price-ascending order, so
  // first-wins per product is still the lowest in-stock listing.
  let merchantRows: MerchantProductRow[] | null = null;
  if (shared) {
    merchantRows = shared.merchantRows.filter(
      (r) => r.in_stock === true && ids.includes(r.product_id)
    );
  } else {
    const { data: merchantData, error: merchantError } = await supabase
      .from('merchant_products')
      .select('product_id, merchant_id, price, availability, url, in_stock')
      .in('product_id', ids)
      .is('deleted_at', null)
      .eq('in_stock', true)
      .order('price', { ascending: true });
    if (merchantError || !merchantData) {
      logger.warn('refreshTrackedPrices: merchant_products query failed', {
        error: merchantError?.message,
      });
      result.failed = ids.length;
      // P1-8: no merchant rows were read, so no price was refreshed.
      result.loadFailed = true;
      result.loadError =
        result.loadError ??
        `merchant_products: ${merchantError?.message ?? 'no rows returned'}`;
      return result;
    }
    merchantRows = merchantData as MerchantProductRow[];
  }

  const lowestByProduct = new Map<string, MerchantProductRow>();
  for (const row of merchantRows) {
    if (!lowestByProduct.has(row.product_id)) lowestByProduct.set(row.product_id, row);
  }

  // Merchant slug -> retailer id, via the shared slug.
  const merchantIds = Array.from(new Set(Array.from(lowestByProduct.values()).map((r) => r.merchant_id)));
  const merchantSlugById = new Map<string, string>();
  if (merchantIds.length > 0) {
    const { data: merchants } = await supabase
      .from('merchants')
      .select('id, slug')
      .in('id', merchantIds);
    for (const m of (merchants ?? []) as Array<{ id: string; slug: string }>) {
      merchantSlugById.set(m.id, m.slug);
    }
  }
  const slugs = Array.from(new Set(Array.from(merchantSlugById.values())));
  const retailerIdBySlug = new Map<string, string>();
  if (slugs.length > 0) {
    const { data: retailers } = await supabase
      .from('retailers')
      .select('id, slug')
      .in('slug', slugs);
    for (const r of (retailers ?? []) as Array<{ id: string; slug: string }>) {
      retailerIdBySlug.set(r.slug, r.id);
    }
  }

  // Latest price_history row per product (newest first, first wins).
  // P1-8: a failed history read must NOT be treated as "no history"
  // — with an empty latest map every product would look changed and
  // the run would insert duplicate rows. Fail the step instead.
  // Section 18, item 31 — with shared reads the history rows are
  // the builder's (same query shape, same newest-first order);
  // filtering to this step's ids keeps first-wins identical.
  let historyRows: PriceHistorySharedRow[] | null = null;
  if (shared) {
    historyRows = shared.historyRows.filter((r) => ids.includes(r.product_id));
  } else {
    const { data: historyData, error: historyError } = await supabase
      .from('price_history')
      .select('product_id, retailer_id, price, availability, recorded_at')
      .in('product_id', ids)
      .order('recorded_at', { ascending: false })
      .limit(1000);
    if (historyError) {
      logger.warn('refreshTrackedPrices: price_history query failed', {
        error: historyError.message,
      });
      result.loadFailed = true;
      result.loadError =
        result.loadError ?? `price_history: ${historyError.message}`;
      return result;
    }
    historyRows = (historyData ?? []) as PriceHistorySharedRow[];
  }
  const latestByKey = new Map<string, { price: number; availability: string }>();
  for (const row of historyRows) {
    const key = `${row.product_id}:${row.retailer_id}`;
    if (!latestByKey.has(key)) {
      latestByKey.set(key, { price: parseFloat(String(row.price)), availability: row.availability });
    }
  }

  for (const productId of ids) {
    try {
      const lowest = lowestByProduct.get(productId);
      if (!lowest || lowest.price === null || lowest.price === undefined) {
        result.skippedNoPrice++;
        continue;
      }
      const price = parseFloat(String(lowest.price));
      if (!Number.isFinite(price)) {
        result.skippedNoPrice++;
        continue;
      }
      const merchantSlug = merchantSlugById.get(lowest.merchant_id);
      const retailerId = merchantSlug ? retailerIdBySlug.get(merchantSlug) : undefined;
      if (!retailerId) {
        result.skippedNoRetailer++;
        continue;
      }
      const availability = lowest.availability ?? (lowest.in_stock ? 'in_stock' : 'out_of_stock');
      const latest = latestByKey.get(`${productId}:${retailerId}`);
      if (latest && latest.price === price && latest.availability === availability) {
        result.unchanged++;
        // Section 15, P1-10: the recorded price was re-verified
        // against the catalog in this run, so the freshness policy
        // layer stamps it. This means "recorded price re-checked",
        // not "live-checked" — a live check (eBay) stamps the same
        // columns from services/ebay-refresh.ts.
        try {
          await markProductRefreshed(supabase, productId);
        } catch {
          // Freshness bookkeeping must never fail the product.
        }
        continue;
      }
      const { error } = await supabase.from('price_history').insert({
        product_id: productId,
        retailer_id: retailerId,
        price,
        currency: 'USD',
        availability,
        url: lowest.url ?? null,
      });
      if (error) {
        logger.warn('refreshTrackedPrices: insert failed', { productId, error: error.message });
        result.failed++;
        try {
          await markProductRefreshFailed(supabase, productId, {
            reason: `price_history insert failed: ${error.message}`,
          });
        } catch {
          // Freshness bookkeeping must never fail the product.
        }
      } else {
        result.inserted++;
        // Section 19, Phase 8 (§12 #14) — a new price point
        // changes the inputs the AI summary / prediction / comparison
        // were computed from, so their cached entries (in-memory
        // AND the stored ai_summaries / ai_predictions rows) are
        // invalidated for this product. The next AI read recomputes
        // from the fresh price. Bookkeeping must never fail the
        // product, so a failure here is swallowed (it is logged
        // inside invalidateAiForProduct); the short SWR TTLs bound
        // the staleness if the delete itself failed.
        try {
          await invalidateAiForProduct(supabase, productId);
        } catch {
          // Invalidation is best-effort; the refresh already succeeded.
        }
        // P1-10: a changed price was recorded, so the freshness
        // stamp moves to this run as well (same "recorded price
        // re-checked" meaning as the unchanged branch above).
        try {
          await markProductRefreshed(supabase, productId);
        } catch {
          // Freshness bookkeeping must never fail the product.
        }
      }
    } catch (err) {
      logger.warn('refreshTrackedPrices: product failed', { productId, error: String(err) });
      result.failed++;
      // Section 18, item 47: the outer catch previously counted the
      // failure but never marked the product failed — so the reason
      // was lost entirely. Mark it like every other failure site.
      try {
        await markProductRefreshFailed(supabase, productId, {
          reason: `refreshTrackedPrices failed: ${String(err)}`,
        });
      } catch {
        // Freshness bookkeeping must never fail the product.
      }
    }
  }

  return result;
}
