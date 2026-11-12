/**
 * API v1 prediction outcomes endpoint.
 * GET  /api/v1/predictions/outcomes — recent recorded outcomes (public).
 * POST /api/v1/predictions/outcomes — record one outcome (cron/admin only).
 *
 * The recorder is what makes accuracy measurable: a prediction is
 * stored as 'pending' when made, then resolved here once its horizon
 * has passed and a real recorded lowest price exists. Resolution uses
 * lib/prediction-accuracy's deterministic rule — a prediction that
 * said a drop was likely (probability >= 50) is correct only when a
 * real drop happened. Nothing is resolved from a guess: without an
 * actual lowest price the row stays 'pending'.
 *
 * POST auth: Bearer CRON_SECRET (same pattern as /api/v1/prices/refresh)
 * or an admin session. Fail-closed when CRON_SECRET is unset.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { apiSuccess, badRequest, internalError, unauthorized } from '@/lib/api/responses';
import { logApiRequest, rateLimitResponse, getClientIp, requireAdmin } from '@/lib/api/middleware';
import { isCronAuthorized } from '@/lib/api/cron-auth';
import { resolvePredictionOutcome } from '@/lib/prediction-accuracy';

export const dynamic = 'force-dynamic';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest) {
  logApiRequest(request, { endpoint: 'predictions.outcomes' });

  const limited = await rateLimitResponse(
    `predictions-outcomes:${getClientIp(request)}`,
    60
  );
  if (limited) return limited;

  try {
    const supabase = await createSupabaseServerClient();
    const limit = Math.min(
      50,
      Math.max(1, Number(request.nextUrl.searchParams.get('limit') ?? 20))
    );
    const { data, error } = await supabase
      .from('prediction_outcomes')
      .select(
        'id, product_id, predicted_at, horizon_days, discount_probability, price_at_prediction, predicted_lowest_price, actual_lowest_price, outcome, resolved_at'
      )
      .order('predicted_at', { ascending: false })
      .limit(limit);

    // Migration not run yet → honest empty list, not a 500.
    if (error || !data) return apiSuccess([]);
    return apiSuccess(data);
  } catch {
    return apiSuccess([]);
  }
}

export async function POST(request: NextRequest) {
  logApiRequest(request, { endpoint: 'predictions.outcomes.record' });

  const limited = await rateLimitResponse(
    `predictions-outcomes-write:${getClientIp(request)}`,
    30
  );
  if (limited) return limited;

  // Cron secret first; fall back to an admin session.
  if (!isCronAuthorized(request)) {
    const auth = await requireAdmin(request);
    if ('error' in auth) return auth.error;
  }

  const service = createSupabaseServiceClient();
  if (!service) {
    return internalError('Outcome recording unavailable: service client not configured');
  }

  try {
    const body = await request.json().catch(() => null);
    const productId = body?.product_id;
    const predictionId = body?.prediction_id ?? null;
    const horizonDays = Number(body?.horizon_days ?? 30);
    const discountProbability = Number(body?.discount_probability);
    const priceAtPrediction =
      body?.price_at_prediction === undefined || body?.price_at_prediction === null
        ? null
        : Number(body.price_at_prediction);
    const predictedLowestPrice =
      body?.predicted_lowest_price === undefined || body?.predicted_lowest_price === null
        ? null
        : Number(body.predicted_lowest_price);
    const actualLowestPrice =
      body?.actual_lowest_price === undefined || body?.actual_lowest_price === null
        ? null
        : Number(body.actual_lowest_price);

    if (typeof productId !== 'string' || !UUID_RE.test(productId)) {
      return badRequest('product_id is required and must be a UUID');
    }
    if (predictionId !== null && (typeof predictionId !== 'string' || !UUID_RE.test(predictionId))) {
      return badRequest('prediction_id must be a UUID or null');
    }
    if (!Number.isInteger(horizonDays) || horizonDays <= 0) {
      return badRequest('horizon_days must be a positive integer');
    }
    if (!Number.isFinite(discountProbability) || discountProbability < 0 || discountProbability > 100) {
      return badRequest('discount_probability must be a number between 0 and 100');
    }
    for (const [name, value] of [
      ['price_at_prediction', priceAtPrediction],
      ['predicted_lowest_price', predictedLowestPrice],
      ['actual_lowest_price', actualLowestPrice],
    ] as const) {
      if (value !== null && (!Number.isFinite(value) || value < 0)) {
        return badRequest(`${name} must be a non-negative number or null`);
      }
    }

    const resolved = resolvePredictionOutcome({
      discountProbability,
      priceAtPrediction,
      actualLowestPrice,
      predictedLowestPrice,
    });

    const row = {
      product_id: productId,
      prediction_id: predictionId,
      horizon_days: horizonDays,
      discount_probability: discountProbability,
      price_at_prediction: priceAtPrediction,
      predicted_lowest_price: predictedLowestPrice,
      actual_lowest_price: actualLowestPrice,
      outcome: resolved ? resolved.status : 'pending',
      resolved_at: resolved ? new Date().toISOString() : null,
    };

    // Dedupe: one outcome per product + horizon + calendar day (the
    // migration's unique index is on DATE(predicted_at), which an
    // upsert onConflict cannot name). Update today's pending row if
    // one exists, otherwise insert.
    const dayStart = new Date();
    dayStart.setUTCHours(0, 0, 0, 0);
    const { data: existing } = await service
      .from('prediction_outcomes')
      .select('id')
      .eq('product_id', productId)
      .eq('horizon_days', horizonDays)
      .gte('predicted_at', dayStart.toISOString())
      .order('predicted_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const existingId = (existing as { id?: string } | null)?.id ?? null;
    const query = existingId
      ? service
          .from('prediction_outcomes')
          .update(row)
          .eq('id', existingId)
          .select('id, outcome')
          .single()
      : service.from('prediction_outcomes').insert(row).select('id, outcome').single();

    const { data, error } = await query;

    if (error) {
      // Most likely the migration has not been run yet.
      return internalError('Failed to record prediction outcome (migration 032 may not be run yet)');
    }

    return apiSuccess(data, 200);
  } catch {
    return internalError('Failed to record prediction outcome');
  }
}
