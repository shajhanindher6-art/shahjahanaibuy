/**
 * API v1 Category Inflation Index endpoint.
 * GET /api/v1/category-inflation — per-category average price change
 * over the trailing 90 days, from real `price_history` rows only.
 * Public, no auth: the index is aggregate public catalog data.
 *
 * A database failure returns an honest empty index (with a note),
 * never a 500 and never a fabricated number — the same fail-open
 * pattern as the commerce services.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess } from '@/lib/api/responses';
import { logApiRequest } from '@/lib/api/middleware';
import { logger } from '@/lib/config/logger';
import {
  computeCategoryInflation,
  CATEGORY_INFLATION_WINDOW_DAYS,
} from '@/services/category-inflation';

// Live DB data must never be served from a stale edge cache (the first
// request after deploy once cached an empty fail-open response).
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  logApiRequest(request, { endpoint: 'category-inflation' });

  try {
    const supabase = await createSupabaseServerClient();

    const [productsRes, historyRes] = await Promise.all([
      supabase
        .from('products')
        .select('id, category')
        .is('deleted_at', null)
        .limit(500),
      supabase
        .from('price_history')
        .select('product_id, price, recorded_at')
        .order('recorded_at', { ascending: true })
        .limit(5000),
    ]);

    if (productsRes.error || historyRes.error) {
      if (productsRes.error) {
        logger.warn('category-inflation: products query failed', {
          error: productsRes.error.message,
        });
      }
      if (historyRes.error) {
        logger.warn('category-inflation: price_history query failed', {
          error: historyRes.error.message,
        });
      }
      return apiSuccess({
        entries: [],
        windowDays: CATEGORY_INFLATION_WINDOW_DAYS,
        historyDays: 0,
        note: 'Category inflation data is unavailable right now.',
        fetchedAt: new Date().toISOString(),
      });
    }

    const categoryByProduct = new Map<string, string | null>();
    for (const row of (productsRes.data ?? []) as Array<{ id: string; category: string | null }>) {
      categoryByProduct.set(row.id, row.category);
    }

    const index = computeCategoryInflation(
      ((historyRes.data ?? []) as Array<{ product_id: string; price: number; recorded_at: string }>).map(
        (r) => ({
          productId: r.product_id,
          category: categoryByProduct.get(r.product_id) ?? null,
          price: Number(r.price),
          recordedAt: r.recorded_at,
        })
      )
    );

    return apiSuccess({
      ...index,
      note: `Average per-product price change over the trailing ${index.windowDays} days, from recorded price history only.`,
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    logger.error('category-inflation: unexpected error', { error: String(err) });
    return apiSuccess({
      entries: [],
      windowDays: CATEGORY_INFLATION_WINDOW_DAYS,
      historyDays: 0,
      note: 'Category inflation data is unavailable right now.',
      fetchedAt: new Date().toISOString(),
    });
  }
}
