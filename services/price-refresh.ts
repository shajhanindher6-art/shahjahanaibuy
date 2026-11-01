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

export interface PriceRefreshResult {
  tracked: number;
  inserted: number;
  unchanged: number;
  skippedNoRetailer: number;
  skippedNoPrice: number;
  failed: number;
}

interface MerchantProductRow {
  product_id: string;
  merchant_id: string;
  price: number | string;
  availability: string | null;
  url: string | null;
  in_stock: boolean;
}

export async function refreshTrackedPrices(
  supabase: AnySupabaseClient
): Promise<PriceRefreshResult> {
  const result: PriceRefreshResult = {
    tracked: 0,
    inserted: 0,
    unchanged: 0,
    skippedNoRetailer: 0,
    skippedNoPrice: 0,
    failed: 0,
  };

  const productIds = new Set<string>();

  const { data: alertRows } = await supabase
    .from('alerts')
    .select('product_id')
    .eq('active', true)
    .limit(1000);
  for (const row of (alertRows ?? []) as Array<{ product_id: string }>) {
    if (row.product_id) productIds.add(row.product_id);
  }

  const { data: wishlistRows } = await supabase
    .from('wishlist_items')
    .select('product_id')
    .limit(1000);
  for (const row of (wishlistRows ?? []) as Array<{ product_id: string }>) {
    if (row.product_id) productIds.add(row.product_id);
  }

  const ids = Array.from(productIds).slice(0, 500);
  result.tracked = ids.length;
  if (ids.length === 0) return result;

  // Lowest in-stock merchant listing per product.
  const { data: merchantRows, error: merchantError } = await supabase
    .from('merchant_products')
    .select('product_id, merchant_id, price, availability, url, in_stock')
    .in('product_id', ids)
    .is('deleted_at', null)
    .eq('in_stock', true)
    .order('price', { ascending: true });
  if (merchantError || !merchantRows) {
    logger.warn('refreshTrackedPrices: merchant_products query failed', {
      error: merchantError?.message,
    });
    result.failed = ids.length;
    return result;
  }

  const lowestByProduct = new Map<string, MerchantProductRow>();
  for (const row of merchantRows as MerchantProductRow[]) {
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
  const { data: historyRows } = await supabase
    .from('price_history')
    .select('product_id, retailer_id, price, availability, recorded_at')
    .in('product_id', ids)
    .order('recorded_at', { ascending: false })
    .limit(1000);
  const latestByKey = new Map<string, { price: number; availability: string }>();
  for (const row of (historyRows ?? []) as Array<{
    product_id: string;
    retailer_id: string;
    price: number | string;
    availability: string;
  }>) {
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
      } else {
        result.inserted++;
      }
    } catch (err) {
      logger.warn('refreshTrackedPrices: product failed', { productId, error: String(err) });
      result.failed++;
    }
  }

  return result;
}
