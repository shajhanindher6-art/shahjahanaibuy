/**
 * API v1 Deal Hotspots endpoint.
 * GET /api/v1/deal-hotspots — a month grid of RECORDED price-drop
 * and deal-start events. Public, no auth: the events are aggregate
 * public catalog data.
 *
 * No probability, no seasonal forecast: the recorded history covers
 * roughly 30 days, so the response carries the coverage note from
 * buildDealHotspots on every render. A database failure returns an
 * honest empty calendar, never a 500 and never invented hotspots.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess } from '@/lib/api/responses';
import { logApiRequest, rateLimitResponse, getClientIp } from '@/lib/api/middleware';
import { logger } from '@/lib/config/logger';
import { logApiError } from '@/lib/api/error-logging';
import { computePriceDrops, type TrendPoint } from '@/lib/price-trend';
import { getDeals } from '@/services/commerce';
import { buildDealHotspots } from '@/services/deal-hotspots';

// Live DB data must never be served from a stale edge cache (the first
// request after deploy once cached an empty fail-open response).
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  logApiRequest(request, { endpoint: 'deal-hotspots' });
  // Section 21–25, Stage J, J-P2-3 — wired: unexpected errors are logged via logApiError (error_log/Sentry) AND the honest empty response below is still returned.
  // Rate limit: 120 requests/min per IP (see docs/rate-limits.md).
  const limited = await rateLimitResponse(`deal-hotspots:${getClientIp(request)}`, 120);
  if (limited) return limited;

  try {
    const supabase = await createSupabaseServerClient();

    const [historyRes, activeDeals, inactiveDeals] = await Promise.all([
      supabase
        .from('price_history')
        .select('product_id, price, recorded_at')
        .order('recorded_at', { ascending: true })
        .limit(5000),
      getDeals(supabase, { active: true, limit: 200 }),
      getDeals(supabase, { active: false, limit: 200 }),
    ]);

    if (historyRes.error) {
      logger.warn('deal-hotspots: price_history query failed', {
        error: historyRes.error.message,
      });
      return apiSuccess({
        months: [],
        totalDrops: 0,
        totalDeals: 0,
        historyDays: 0,
        coverageNote: 'Deal hotspot data is unavailable right now.',
        fetchedAt: new Date().toISOString(),
      });
    }

    const rows = (historyRes.data ?? []) as Array<{
      product_id: string;
      price: number;
      recorded_at: string;
    }>;

    // Real point-to-point decreases, per product (oldest-first).
    const byProduct = new Map<string, TrendPoint[]>();
    for (const r of rows) {
      const price = Number(r.price);
      if (!Number.isFinite(price) || !r.recorded_at) continue;
      const list = byProduct.get(r.product_id) ?? [];
      list.push({ price, recordedAt: r.recorded_at });
      byProduct.set(r.product_id, list);
    }
    const drops = [...byProduct.entries()].flatMap(([productId, points]) =>
      computePriceDrops(
        [...points].sort(
          (a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime()
        )
      ).map((d) => ({ date: d.date, productId }))
    );

    const deals = [...activeDeals, ...inactiveDeals]
      .filter((d) => d.startAt)
      .map((d) => ({ date: d.startAt as string, dealId: d.id }));

    const historyStart = rows.length > 0 ? rows[0].recorded_at : null;
    const historyEnd = rows.length > 0 ? rows[rows.length - 1].recorded_at : null;

    return apiSuccess({
      ...buildDealHotspots({ drops, deals, historyStart, historyEnd }),
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    logger.error('deal-hotspots: unexpected error', { error: String(err) });
    logApiError(err, { request, route: 'deal-hotspots', status: 500 });
    return apiSuccess({
      months: [],
      totalDrops: 0,
      totalDeals: 0,
      historyDays: 0,
      coverageNote: 'Deal hotspot data is unavailable right now.',
      fetchedAt: new Date().toISOString(),
    });
  }
}
