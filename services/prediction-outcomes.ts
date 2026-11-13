/**
 * Prediction-outcomes auto-recorder (Section 19, Phase 3, §12 #34).
 *
 * The accuracy infra (lib/prediction-accuracy + the outcomes API)
 * was complete but nothing ever called it — resolved outcomes were
 * 0 by construction, so an accuracy % could never publish. This
 * module closes the loop:
 *
 *   1. RECORD at prediction time — predictPriceDrop calls
 *      recordPredictionOutcome() after storing the prediction, so
 *      every prediction starts life as a 'pending' outcome row.
 *   2. RESOLVE on the refresh run — the prices/refresh chain runs
 *      resolvePendingPredictionOutcomes() as a step, which resolves
 *      each due row against the lowest price actually recorded
 *      inside its horizon (never a guess: no actual price yet →
 *      the row stays 'pending').
 *
 * STORAGE ACTIVATES ONLY AFTER THE OWNER APPLIES MIGRATION 032.
 * Until then the `prediction_outcomes` table does not exist and
 * every call here fails SAFE: a missing-table error (PGRST205 /
 * 42P01) is logged once per process and reported as
 * 'missing-table' / a clean skip — it never throws, never breaks
 * the prediction or the refresh flow, and never fails a run.
 * Writes go through the service-role client only (migration 032
 * grants no INSERT policy — only the service role writes outcomes).
 */

import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { logger } from '@/lib/config/logger';
import { resolvePredictionOutcome } from '@/lib/prediction-accuracy';
import type { AnySupabaseClient } from '@/lib/supabase/types';

/** Default horizon for a recorded outcome (matches the outcomes API). */
export const OUTCOME_DEFAULT_HORIZON_DAYS = 30;

export type OutcomeRecordStatus =
  | 'recorded'
  | 'already-recorded'
  | 'skipped'
  | 'missing-table'
  | 'unavailable';

export interface RecordPredictionOutcomeInput {
  productId: string;
  discountProbability: number;
  priceAtPrediction: number | null;
  predictedLowestPrice: number | null;
  /** Horizon in days; defaults to 30. */
  horizonDays?: number;
}

export interface RecordPredictionOutcomeResult {
  status: OutcomeRecordStatus;
}

export interface ResolvePendingOutcomesResult {
  /** False only when no client is available at all. */
  ok: boolean;
  /** 'table-missing' when 032 is unapplied (clean skip); 'unavailable' when no service client. */
  reason?: string;
  checked: number;
  resolved: number;
  stillPending: number;
  failed: number;
}

/** Missing-table is logged once per process, not on every prediction. */
let missingTableWarned = false;

function logMissingTableOnce(context: string): void {
  if (missingTableWarned) return;
  missingTableWarned = true;
  logger.warn(
    'prediction-outcomes: table missing — storage activates only after the owner applies migration 032',
    { context }
  );
}

function isMissingTableError(error: unknown): boolean {
  const err = error as { code?: string; message?: string } | null;
  if (!err) return false;
  return (
    err.code === '42P01' ||
    err.code === 'PGRST205' ||
    /relation .* does not exist/i.test(err.message ?? '') ||
    /could not find the table/i.test(err.message ?? '')
  );
}

function dayStartIso(now: Date): string {
  const dayStart = new Date(now);
  dayStart.setUTCHours(0, 0, 0, 0);
  return dayStart.toISOString();
}

/**
 * Record one prediction as a 'pending' outcome row (dedupe: one
 * outcome per product + horizon + calendar day, per the migration's
 * unique index). Never throws — every failure path returns a
 * status instead, so a prediction is never lost to the recorder.
 */
export async function recordPredictionOutcome(
  input: RecordPredictionOutcomeInput,
  client?: AnySupabaseClient | null
): Promise<RecordPredictionOutcomeResult> {
  try {
    const service = client ?? createSupabaseServiceClient();
    if (!service) return { status: 'unavailable' };

    const horizonDays = input.horizonDays ?? OUTCOME_DEFAULT_HORIZON_DAYS;
    if (!Number.isInteger(horizonDays) || horizonDays <= 0) {
      return { status: 'skipped' };
    }
    if (
      !Number.isFinite(input.discountProbability) ||
      input.discountProbability < 0 ||
      input.discountProbability > 100
    ) {
      return { status: 'skipped' };
    }

    // Dedupe: today's pending row already exists → nothing to do.
    const { data: existing, error: readError } = await service
      .from('prediction_outcomes')
      .select('id')
      .eq('product_id', input.productId)
      .eq('horizon_days', horizonDays)
      .gte('predicted_at', dayStartIso(new Date()))
      .order('predicted_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (readError) {
      if (isMissingTableError(readError)) {
        logMissingTableOnce('record');
        return { status: 'missing-table' };
      }
      logger.warn('prediction-outcomes: outcome read failed', {
        error: String(readError.message ?? readError),
      });
      return { status: 'skipped' };
    }
    if (existing) return { status: 'already-recorded' };

    const { error: insertError } = await service.from('prediction_outcomes').insert({
      product_id: input.productId,
      prediction_id: null,
      horizon_days: horizonDays,
      discount_probability: input.discountProbability,
      price_at_prediction: input.priceAtPrediction,
      predicted_lowest_price: input.predictedLowestPrice,
      actual_lowest_price: null,
      outcome: 'pending',
      resolved_at: null,
    });

    if (insertError) {
      // Unique-index race with another recorder run: the row is
      // there now, which is the outcome we wanted.
      if ((insertError as { code?: string }).code === '23505') {
        return { status: 'already-recorded' };
      }
      if (isMissingTableError(insertError)) {
        logMissingTableOnce('record');
        return { status: 'missing-table' };
      }
      logger.warn('prediction-outcomes: outcome insert failed', {
        error: String(insertError.message ?? insertError),
      });
      return { status: 'skipped' };
    }

    return { status: 'recorded' };
  } catch (err) {
    // The recorder must never break the prediction flow.
    logger.warn('prediction-outcomes: record threw (fail-safe skip)', {
      error: String(err),
    });
    return { status: 'skipped' };
  }
}

interface PendingOutcomeRow {
  id: string;
  product_id: string;
  predicted_at: string;
  horizon_days: number;
  discount_probability: number;
  price_at_prediction: number | null;
  predicted_lowest_price: number | null;
}

/**
 * Resolve every due 'pending' outcome against the lowest price
 * actually recorded inside its horizon window. A row whose
 * horizon has not passed yet — or that has no recorded price in
 * its window — stays 'pending': an outcome is only ever resolved
 * from recorded data, never from a guess. Never throws.
 */
export async function resolvePendingPredictionOutcomes(
  client?: AnySupabaseClient | null,
  now: Date = new Date()
): Promise<ResolvePendingOutcomesResult> {
  const zero: ResolvePendingOutcomesResult = {
    ok: false,
    checked: 0,
    resolved: 0,
    stillPending: 0,
    failed: 0,
  };
  try {
    const service = client ?? createSupabaseServiceClient();
    if (!service) return { ...zero, reason: 'unavailable' };

    const { data, error } = await service
      .from('prediction_outcomes')
      .select(
        'id, product_id, predicted_at, horizon_days, discount_probability, price_at_prediction, predicted_lowest_price'
      )
      .eq('outcome', 'pending')
      .order('predicted_at', { ascending: true })
      .limit(200);

    if (error) {
      if (isMissingTableError(error)) {
        logMissingTableOnce('resolve');
        return { ok: true, reason: 'table-missing', checked: 0, resolved: 0, stillPending: 0, failed: 0 };
      }
      logger.warn('prediction-outcomes: pending read failed', {
        error: String(error.message ?? error),
      });
      return { ...zero, reason: 'read-failed' };
    }

    const rows = (data ?? []) as PendingOutcomeRow[];
    let resolved = 0;
    let stillPending = 0;
    let failed = 0;

    for (const row of rows) {
      const predictedAtMs = new Date(row.predicted_at).getTime();
      if (!Number.isFinite(predictedAtMs)) {
        failed++;
        continue;
      }
      const horizonEndMs = predictedAtMs + row.horizon_days * 86_400_000;
      if (now.getTime() < horizonEndMs) {
        stillPending++;
        continue;
      }

      try {
        const { data: history, error: historyError } = await service
          .from('price_history')
          .select('price')
          .eq('product_id', row.product_id)
          .gte('recorded_at', row.predicted_at)
          .lte('recorded_at', new Date(horizonEndMs).toISOString())
          .order('recorded_at', { ascending: true })
          .limit(5000);

        if (historyError) {
          if (isMissingTableError(historyError)) {
            logMissingTableOnce('resolve-history');
            stillPending++;
            continue;
          }
          failed++;
          continue;
        }

        const prices = ((history ?? []) as Array<{ price: number | string }>)
          .map((r) => Number(r.price))
          .filter((p) => Number.isFinite(p) && p > 0);
        if (prices.length === 0) {
          // No price was recorded inside the horizon — keep the
          // row pending; a later refresh may see one.
          stillPending++;
          continue;
        }

        const actualLowestPrice = Math.min(...prices);
        const outcome = resolvePredictionOutcome({
          discountProbability: Number(row.discount_probability),
          priceAtPrediction:
            row.price_at_prediction === null ? null : Number(row.price_at_prediction),
          actualLowestPrice,
          predictedLowestPrice:
            row.predicted_lowest_price === null
              ? null
              : Number(row.predicted_lowest_price),
        });

        if (!outcome) {
          stillPending++;
          continue;
        }

        const { error: updateError } = await service
          .from('prediction_outcomes')
          .update({
            actual_lowest_price: actualLowestPrice,
            outcome: outcome.status,
            resolved_at: now.toISOString(),
          })
          .eq('id', row.id);

        if (updateError) {
          if (isMissingTableError(updateError)) {
            logMissingTableOnce('resolve-update');
            stillPending++;
            continue;
          }
          failed++;
          continue;
        }
        resolved++;
      } catch {
        failed++;
      }
    }

    return { ok: true, checked: rows.length, resolved, stillPending, failed };
  } catch (err) {
    logger.warn('prediction-outcomes: resolve threw (fail-safe)', {
      error: String(err),
    });
    return { ...zero, reason: 'threw' };
  }
}
