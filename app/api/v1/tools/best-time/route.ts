/**
 * API v1 Best-Time-to-Buy Calendar — GET /api/v1/tools/best-time.
 *
 * Category-wise best-buy calendar from RECORDED price_history only
 * (lib/best-time-calendar.ts). Ranges only — never an exact date
 * promise, never a future price. Categories without enough recorded
 * history are reported honestly as "insufficient".
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess, internalError } from '@/lib/api/responses';
import { logApiRequest, rateLimitResponse, getClientIp } from '@/lib/api/middleware';
import { getProducts } from '@/services/products';
import { getPriceHistory } from '@/services/price-history';
import { buildBestTimeCalendar, type BestTimePoint } from '@/lib/best-time-calendar';

import { logApiError } from '@/lib/api/error-logging';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  logApiRequest(request, { endpoint: 'tools.best-time' });

  const limited = await rateLimitResponse(`tools-best-time:${getClientIp(request)}`, 60);
  if (limited) return limited;

  try {
    const supabase = await createSupabaseServerClient();
    // The catalog is small; one page covers it. Fail-safe: the
    // services below return empty lists when tables are missing.
    const { products } = await getProducts(supabase, { page: 1, pageSize: 100 });

    const points: BestTimePoint[] = [];
    await Promise.all(
      products.map(async (product) => {
        const category = product.category ?? 'Uncategorized';
        const result = await getPriceHistory(supabase, product.id, { limit: 500 });
        for (const h of result.history ?? []) {
          points.push({
            category,
            price: Number(h.price),
            recordedAt: h.recordedAt,
          });
        }
      })
    );

    const categories = buildBestTimeCalendar(points);

    return apiSuccess({
      categories,
      note: 'Best months come from recorded price history only. Ranges only — no exact date is promised and no future price is predicted.',
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    logApiError(err, { request, route: 'tools.best-time', status: 500 });
    return internalError('Failed to build the best-time calendar');
  }
}
