/**
 * API v1 probabilistic price forecast endpoint.
 * GET /api/v1/forecast/[productId] — range + confidence % per
 * horizon (7 / 30 / 90 days) plus a 30-day backtest summary, all
 * computed ONLY from the product's recorded `price_history` rows.
 * Public, no auth: a forecast is aggregate public catalog data.
 *
 * A product with fewer than 2 recorded prices returns
 * status 'not-enough-history' (200, honest empty) — never a
 * fabricated range. A database failure returns the same honest
 * empty forecast, never a 500 and never an invented number.
 * The forecast is a RANGE, never an exact future price or date.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess, notFound } from '@/lib/api/responses';
import { logApiRequest, rateLimitResponse, getClientIp } from '@/lib/api/middleware';
import { logger } from '@/lib/config/logger';
import { getProductById, getProductBySlug } from '@/services/products';
import { computeForecast, backtestForecast } from '@/lib/forecast';

// Live DB data must never be served from a stale edge cache.
export const dynamic = 'force-dynamic';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  request: NextRequest,
  { params }: { params: { productId: string } }
) {
  logApiRequest(request, { endpoint: 'forecast', productId: params.productId });

  const limited = await rateLimitResponse(`forecast:${getClientIp(request)}`, 30);
  if (limited) return limited;

  const emptyForecast = (product: { id: string; name: string; slug: string; category: string | null } | null) =>
    apiSuccess({
      product: product
        ? { id: product.id, name: product.name, slug: product.slug, category: product.category }
        : null,
      currentPrice: null,
      historyPoints: 0,
      historyDays: 0,
      status: 'not-enough-history',
      forecasts: [],
      backtest: {
        horizonDays: 30,
        trials: 0,
        hits: 0,
        accuracyPct: null,
        status: 'not-enough-history',
        note: 'Not enough price history yet to backtest.',
      },
      method:
        'Least-squares trend fitted to recorded price history only; range = fitted value ± 1.96 × residual spread.',
      note: 'Forecast data is unavailable right now.',
      fetchedAt: new Date().toISOString(),
    });

  try {
    const supabase = await createSupabaseServerClient();
    const resolved = UUID_RE.test(params.productId)
      ? await getProductById(supabase, params.productId)
      : await getProductBySlug(supabase, params.productId);

    if (!resolved) {
      return notFound('Product not found');
    }

    const product = {
      id: resolved.id,
      name: resolved.name,
      slug: resolved.slug,
      category: (resolved as { category?: string | null }).category ?? null,
    };

    const { data, error } = await supabase
      .from('price_history')
      .select('price, recorded_at')
      .eq('product_id', resolved.id)
      .order('recorded_at', { ascending: true })
      .limit(5000);

    if (error) {
      logger.warn('forecast: price_history query failed', { error: error.message });
      return emptyForecast(product);
    }

    const points = ((data ?? []) as Array<{ price: number; recorded_at: string }>).map(
      (r) => ({ price: Number(r.price), recordedAt: r.recorded_at })
    );
    const forecast = computeForecast(points);
    const backtest = backtestForecast(points, 30);

    return apiSuccess({
      product,
      currentPrice: forecast.currentPrice,
      historyPoints: forecast.pointsUsed,
      historyDays: forecast.historyDays,
      status: forecast.status,
      forecasts: forecast.forecasts,
      backtest: {
        horizonDays: backtest.horizonDays,
        trials: backtest.trials,
        hits: backtest.hits,
        accuracyPct: backtest.accuracyPct,
        status: backtest.status,
        note: backtest.note,
      },
      method: forecast.method,
      note: forecast.note,
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    logger.error('forecast: unexpected error', { error: String(err) });
    return emptyForecast(null);
  }
}
