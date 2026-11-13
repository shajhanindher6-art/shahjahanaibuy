/**
 * API v1 Price History Explorer — GET /api/v1/tools/price-history.
 *
 * Every product's recorded 30-day history side by side: biggest %
 * drop, now vs 30-day low / high / average. Public, no auth.
 *
 * Honesty: stats come ONLY from recorded `price_history` points
 * (the live seed has 4 points per product, Amazon only). Each
 * product carries its pointCount; a product with no history is
 * listed with stats null, never zero-filled. ?sort=biggest-drop |
 * lowest-price | current-price | name (default biggest-drop).
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess, internalError } from '@/lib/api/responses';
import { logApiRequest, rateLimitResponse, getClientIp } from '@/lib/api/middleware';
import { getProducts } from '@/services/products';
import { getPriceHistory } from '@/services/price-history';
import {
  buildProductHistorySummary,
  parseExplorerSort,
  sortHistorySummaries,
} from '@/lib/price-history-explorer';

import { logApiError } from '@/lib/api/error-logging';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  logApiRequest(request, { endpoint: 'tools.price-history' });

  const limited = await rateLimitResponse(`tools-price-history:${getClientIp(request)}`, 60);
  if (limited) return limited;

  try {
    const supabase = await createSupabaseServerClient();
    const sortBy = parseExplorerSort({
      sort: request.nextUrl.searchParams.get('sort') ?? undefined,
    });
    const { products } = await getProducts(supabase, { page: 1, pageSize: 100 });

    const summaries = await Promise.all(
      products.map(async (product) => {
        const result = await getPriceHistory(supabase, product.id, { limit: 500 });
        return buildProductHistorySummary(
          {
            id: product.id,
            name: product.name,
            slug: product.slug,
            brand: product.brand,
            category: product.category,
          },
          (result.history ?? []).map((h) => ({
            price: Number(h.price),
            recordedAt: h.recordedAt,
            source: h.source ?? null,
          }))
        );
      })
    );

    return apiSuccess({
      products: sortHistorySummaries(summaries, sortBy),
      sortBy,
      note: 'Stats come from recorded price history only. A product needs at least 5 recorded points with a fresh latest point (within 7 days) before its stats and biggest drop are shown — below that the recorded points are listed but no trend verdict is drawn from them. No smoothing or interpolation.',
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    logApiError(err, { request, route: 'tools.price-history', status: 500 });
    return internalError('Failed to build the price history explorer');
  }
}
