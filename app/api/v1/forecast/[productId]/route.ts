/**
 * API v1 probabilistic price forecast endpoint.
 * GET /api/v1/forecast/[productId] — range + confidence % per
 * horizon (7 / 30 / 90 days) plus a 30-day backtest summary, all
 * computed ONLY from the product's recorded `price_history` rows.
 * Public, no auth: a forecast is aggregate public catalog data.
 *
 * Section 19, Phase 3 (§12 #35): `?horizon=` requests a single
 * configurable period (7 / 14 / 30 / 60 / 90 days) — the forecasts
 * array and the backtest then cover that horizon only. Anything
 * else is a 400. Without the parameter the defaults apply
 * ([7, 30, 90] + a 30-day backtest).
 *
 * A product with fewer than 2 recorded prices returns
 * status 'not-enough-history' (200, honest empty) — never a
 * fabricated range. A database failure returns the same honest
 * empty forecast, never a 500 and never an invented number.
 * The forecast is a RANGE, never an exact future price or date.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess, badRequest, notFound } from '@/lib/api/responses';
import { logApiRequest, rateLimitResponse, getClientIp } from '@/lib/api/middleware';
import { logApiError } from '@/lib/api/error-logging';
import { logger } from '@/lib/config/logger';
import { getProductById, getProductBySlug } from '@/services/products';
import {
  computeForecast,
  backtestForecast,
  FORECAST_HORIZONS,
  FORECAST_ALLOWED_HORIZONS,
  isAllowedForecastHorizon,
} from '@/lib/forecast';

// Live DB data must never be served from a stale edge cache.
export const dynamic = 'force-dynamic';

// Section 19, Phase 3 (§12 #35): the forecast fits ranges from
// recorded history — the work is CPU-bound, not I/O-bound — but a
// slow database read must not run past the platform default
// unnoticed. 60s is the Vercel Hobby cap; do not raise it without
// a paid plan.
export const maxDuration = 60;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  request: NextRequest,
  { params }: { params: { productId: string } }
) {
  logApiRequest(request, { endpoint: 'forecast', productId: params.productId });

  const limited = await rateLimitResponse(`forecast:${getClientIp(request)}`, 30);
  if (limited) return limited;

  // Section 19, Phase 3 (§12 #35): configurable period. A single
  // horizon narrows both the forecasts and the backtest to it;
  // anything outside 7 / 14 / 30 / 60 / 90 is a 400, before any
  // database work. No parameter → the [7, 30, 90] defaults.
  const horizonRaw = request.nextUrl.searchParams.get('horizon');
  let horizons: readonly number[] = FORECAST_HORIZONS;
  let backtestHorizon = 30;
  if (horizonRaw !== null) {
    const horizon = Number(horizonRaw);
    if (!Number.isInteger(horizon) || !isAllowedForecastHorizon(horizon)) {
      return badRequest(
        `horizon must be one of ${FORECAST_ALLOWED_HORIZONS.join(', ')}`
      );
    }
    horizons = [horizon];
    backtestHorizon = horizon;
  }

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
        horizonDays: backtestHorizon,
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
    const forecast = computeForecast(points, Date.now(), horizons);
    const backtest = backtestForecast(points, backtestHorizon);

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
    // Section 19, Phase 3 (§12 #35): the catch path logs through
    // logApiError (structured log + Sentry when configured +
    // error_log when migration 048 is applied) instead of only
    // logger.error — the forecast route was one of the unwired
    // routes. The response is unchanged: the honest empty
    // forecast, never a 500.
    logApiError(err, {
      request,
      route: 'forecast',
      status: 500,
      context: { productId: params.productId },
    });
    logger.error('forecast: unexpected error', { error: String(err) });
    return emptyForecast(null);
  }
}
