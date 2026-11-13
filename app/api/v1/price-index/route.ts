/**
 * API v1 SmartBuy Price Index endpoint.
 * GET /api/v1/price-index?category=&region= — monthly per-category /
 * per-region index from RECORDED `price_history` rows only (region
 * from the retailer's recorded country; 'GLOBAL' pools all regions).
 * Public, no auth: the index is aggregate public catalog data.
 *
 * A database failure returns an honest empty index (with a note),
 * never a 500 and never a fabricated number — the same fail-open
 * pattern as the category-inflation endpoint. Months with too few
 * products are 'insufficient' rows with indexValue null, and every
 * value carries its depth (productsUsed / pointsUsed) so thin data
 * is visible, never hidden.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess } from '@/lib/api/responses';
import { logApiRequest, rateLimitResponse, getClientIp } from '@/lib/api/middleware';
import { logger } from '@/lib/config/logger';
import { logApiError } from '@/lib/api/error-logging';
import { computePriceIndex } from '@/lib/price-index';

// Live DB data must never be served from a stale edge cache.
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  logApiRequest(request, { endpoint: 'price-index' });
  // Section 21–25, Stage J, J-P2-3 — wired: unexpected errors are logged via logApiError (error_log/Sentry) AND the honest empty response below is still returned.

  const limited = await rateLimitResponse(`price-index:${getClientIp(request)}`, 60);
  if (limited) return limited;

  const category = request.nextUrl.searchParams.get('category') || null;
  const regionParam = request.nextUrl.searchParams.get('region') || null;
  const region =
    regionParam && regionParam.trim().length > 0
      ? regionParam.trim().toUpperCase()
      : null;

  const emptyIndex = (note: string) =>
    apiSuccess({
      entries: [],
      summaries: [],
      categories: [],
      regions: ['GLOBAL'],
      baseMonth: null,
      historyDays: 0,
      pointsUsed: 0,
      note,
      fetchedAt: new Date().toISOString(),
    });

  try {
    const supabase = await createSupabaseServerClient();

    const [productsRes, retailersRes, historyRes] = await Promise.all([
      supabase.from('products').select('id, category').limit(500),
      supabase.from('retailers').select('id, country').limit(500),
      supabase
        .from('price_history')
        .select('product_id, retailer_id, price, recorded_at')
        .order('recorded_at', { ascending: true })
        .limit(5000),
    ]);

    if (productsRes.error || retailersRes.error || historyRes.error) {
      for (const [label, res] of [
        ['products', productsRes],
        ['retailers', retailersRes],
        ['price_history', historyRes],
      ] as const) {
        if (res.error) {
          logger.warn(`price-index: ${label} query failed`, { error: res.error.message });
        }
      }
      return emptyIndex('Price Index data is unavailable right now.');
    }

    const categoryByProduct = new Map<string, string | null>();
    for (const row of (productsRes.data ?? []) as Array<{ id: string; category: string | null }>) {
      categoryByProduct.set(row.id, row.category);
    }
    const countryByRetailer = new Map<string, string | null>();
    for (const row of (retailersRes.data ?? []) as Array<{ id: string; country: string | null }>) {
      countryByRetailer.set(row.id, row.country);
    }

    const index = computePriceIndex(
      ((historyRes.data ?? []) as Array<{
        product_id: string;
        retailer_id: string;
        price: number;
        recorded_at: string;
      }>).map((r) => ({
        productId: r.product_id,
        category: categoryByProduct.get(r.product_id) ?? null,
        region: countryByRetailer.get(r.retailer_id) ?? null,
        price: Number(r.price),
        recordedAt: r.recorded_at,
      })),
      { category, region }
    );

    return apiSuccess({
      ...index,
      note: 'Monthly index from recorded price history only (base month = 100). Months with fewer than 2 products with recorded prices are shown as insufficient data, never estimated.',
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    logger.error('price-index: unexpected error', { error: String(err) });
    logApiError(err, { request, route: 'price-index', status: 500 });
    return emptyIndex('Price Index data is unavailable right now.');
  }
}
