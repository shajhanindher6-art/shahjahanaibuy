/**
 * API v1 Forecast Explainer — GET /api/v1/tools/forecast-explainer.
 *
 * The forecast engine (lib/forecast.ts OLS + walk-forward backtest)
 * exists, but no page ever showed backtest accuracy numbers or
 * explained ranges in plain language. This route returns, per
 * product: the 7/30/90-day forecast ranges with plain-language
 * explanations, the backtest report per horizon (trials, hits,
 * accuracyPct — null when there are no trials), and the
 * recorded-outcomes accuracy summary (gated at 20 resolved
 * outcomes by lib/prediction-accuracy.ts).
 *
 * Honesty: with 4 recorded points over ~30 days, backtests are
 * thin — a 30-day backtest has 0 trials and says so. Accuracy is
 * never promised; the response carries "n trials" per horizon and
 * the gate status for the recorded-outcomes percentage.
 * Public, no auth.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess, internalError } from '@/lib/api/responses';
import { logApiRequest, rateLimitResponse, getClientIp } from '@/lib/api/middleware';
import { getProducts } from '@/services/products';
import { getPriceHistory } from '@/services/price-history';
import {
  backtestForecast,
  computeForecast,
  FORECAST_HORIZONS,
} from '@/lib/forecast';
import {
  summarizeAccuracy,
  type AccuracyOutcomeRow,
} from '@/lib/prediction-accuracy';

import { logApiError } from '@/lib/api/error-logging';
export const dynamic = 'force-dynamic';

function explainForecast(
  direction: 'down' | 'up' | 'flat',
  horizonDays: number,
  central: number,
  low: number,
  high: number,
  confidencePct: number
): string {
  const trend =
    direction === 'down'
      ? 'the recent trend points down'
      : direction === 'up'
        ? 'the recent trend points up'
        : 'the recent trend is flat';
  return (
    `In ${horizonDays} days the price is most likely around $${central.toFixed(2)} ` +
    `(${trend}), but the honest range is $${low.toFixed(2)}–$${high.toFixed(2)}. ` +
    `That range is a fit to recorded prices, not a promise — the fit itself ` +
    `is rated ${confidencePct}% confident, and the range may miss.`
  );
}

export async function GET(request: NextRequest) {
  logApiRequest(request, { endpoint: 'tools.forecast-explainer' });

  const limited = await rateLimitResponse(
    `tools-forecast-explainer:${getClientIp(request)}`,
    60
  );
  if (limited) return limited;

  try {
    const supabase = await createSupabaseServerClient();
    const { products } = await getProducts(supabase, { page: 1, pageSize: 100 });

    const items = await Promise.all(
      products.map(async (product) => {
        const result = await getPriceHistory(supabase, product.id, { limit: 500 });
        const points = (result.history ?? []).map((h) => ({
          price: Number(h.price),
          recordedAt: h.recordedAt,
        }));
        const forecast = computeForecast(points, Date.now(), FORECAST_HORIZONS, {
          // Section 21, Stage E (E-P1-1) — the product's real last
          // check is the freshness input; stale inputs withhold
          // the forecast instead of presenting it as current.
          lastCheckedAt: product.dataFreshness ?? null,
        });
        const backtests = FORECAST_HORIZONS.map((horizonDays) => ({
          ...backtestForecast(points, horizonDays, Date.now(), {
            lastCheckedAt: product.dataFreshness ?? null,
          }),
        }));
        return {
          productId: product.id,
          name: product.name,
          slug: product.slug,
          brand: product.brand,
          category: product.category,
          pointCount: points.length,
          currentPrice: forecast.currentPrice,
          status: forecast.status,
          method: forecast.method,
          forecasts: forecast.forecasts.map((f) => ({
            ...f,
            plainLanguage: explainForecast(
              f.direction,
              f.horizonDays,
              f.central,
              f.low,
              f.high,
              f.confidencePct
            ),
          })),
          backtests,
        };
      })
    );

    // Recorded prediction outcomes (the dashboard accuracy %).
    // A missing table or query failure means "no recorded outcomes
    // yet" — never a fabricated percentage.
    let outcomeSummary = summarizeAccuracy([]);
    try {
      const { data } = await supabase
        .from('prediction_outcomes')
        .select('status, horizon_days')
        .limit(500);
      if (data) {
        outcomeSummary = summarizeAccuracy(
          (data as Array<{ status: string; horizon_days: number }>).map((row) => ({
            status: row.status as AccuracyOutcomeRow['status'],
            horizonDays: row.horizon_days,
          }))
        );
      }
    } catch {
      outcomeSummary = summarizeAccuracy([]);
    }

    return apiSuccess({
      products: items,
      recordedOutcomes: outcomeSummary,
      note: 'Forecasts are probabilistic ranges fitted to recorded price history only — never a promised price or date. Backtests are thin while history is ~30 days: each horizon shows its trial count, and accuracy is null when there are no trials.',
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    logApiError(err, { request, route: 'tools.forecast-explainer', status: 500 });
    return internalError('Failed to build the forecast explainer');
  }
}
