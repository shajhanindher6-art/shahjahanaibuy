/**
 * API v1 forecast backtest endpoint.
 * GET /api/v1/forecast/[productId]/backtest?horizon=30 — the full
 * walk-forward backtest report for one horizon (7, 30, or 90 days):
 * every past forecast this product's own recorded history allows,
 * each checked against the price actually recorded at its horizon
 * date. Public, no auth.
 *
 * Zero trials (the normal state while history is ~30 days) returns
 * accuracyPct null with status 'not-enough-history' — never a
 * fabricated accuracy %. A database failure returns the same honest
 * empty report, never a 500.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess, badRequest, notFound } from '@/lib/api/responses';
import { logApiRequest, rateLimitResponse, getClientIp } from '@/lib/api/middleware';
import { logger } from '@/lib/config/logger';
import { getProductById, getProductBySlug } from '@/services/products';
import { backtestForecast, FORECAST_HORIZONS } from '@/lib/forecast';

// Live DB data must never be served from a stale edge cache.
export const dynamic = 'force-dynamic';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  request: NextRequest,
  { params }: { params: { productId: string } }
) {
  logApiRequest(request, { endpoint: 'forecast-backtest', productId: params.productId });

  const limited = await rateLimitResponse(`forecast-backtest:${getClientIp(request)}`, 30);
  if (limited) return limited;

  const horizonRaw = request.nextUrl.searchParams.get('horizon') ?? '30';
  const horizon = Number(horizonRaw);
  if (
    !Number.isInteger(horizon) ||
    !(FORECAST_HORIZONS as readonly number[]).includes(horizon)
  ) {
    return badRequest('horizon must be one of 7, 30, 90');
  }

  try {
    const supabase = await createSupabaseServerClient();
    const resolved = UUID_RE.test(params.productId)
      ? await getProductById(supabase, params.productId)
      : await getProductBySlug(supabase, params.productId);

    if (!resolved) {
      return notFound('Product not found');
    }

    const { data, error } = await supabase
      .from('price_history')
      .select('price, recorded_at')
      .eq('product_id', resolved.id)
      .order('recorded_at', { ascending: true })
      .limit(5000);

    if (error) {
      logger.warn('forecast-backtest: price_history query failed', {
        error: error.message,
      });
      return apiSuccess({
        product: { id: resolved.id, name: resolved.name, slug: resolved.slug },
        horizonDays: horizon,
        trials: 0,
        hits: 0,
        accuracyPct: null,
        entries: [],
        status: 'not-enough-history',
        note: 'Backtest data is unavailable right now.',
        fetchedAt: new Date().toISOString(),
      });
    }

    const points = ((data ?? []) as Array<{ price: number; recorded_at: string }>).map(
      (r) => ({ price: Number(r.price), recordedAt: r.recorded_at })
    );
    const report = backtestForecast(points, horizon as 7 | 30 | 90);

    return apiSuccess({
      product: { id: resolved.id, name: resolved.name, slug: resolved.slug },
      ...report,
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    logger.error('forecast-backtest: unexpected error', { error: String(err) });
    return apiSuccess({
      product: null,
      horizonDays: horizon,
      trials: 0,
      hits: 0,
      accuracyPct: null,
      entries: [],
      status: 'not-enough-history',
      note: 'Backtest data is unavailable right now.',
      fetchedAt: new Date().toISOString(),
    });
  }
}
