/**
 * Shared AI prediction-accuracy source (Section 19, Phase 7,
 * §12 #71 + #72).
 *
 * ONE accuracy computation, used by both the AI admin control
 * center (/admin/ai, via its API route) and the owner dashboard
 * (/owner) — no second computation anywhere. It reads the recorded
 * rows from `prediction_outcomes` and summarizes them with the
 * pure `summarizeAccuracy` from lib/prediction-accuracy, which
 * publishes a percentage only once ACCURACY_MIN_RESOLVED (20)
 * outcomes have resolved.
 *
 * STORAGE ACTIVATES ONLY AFTER THE OWNER APPLIES MIGRATION 032.
 * Until then the table does not exist and this function fails
 * SAFE: a missing-table error (PGRST205 / 42P01) returns
 * `{ tableMissing: true }` with the honest empty summary — never
 * a throw, never a 0% presented as a measurement. Any other read
 * error is reported in `error`, also with the empty summary.
 * Reads go through the service-role client the caller passes
 * (migration 032 grants no anon/authenticated read policy).
 */

import { logger } from '@/lib/config/logger';
import {
  summarizeAccuracy,
  accuracySummaryLine,
  type AccuracySummary,
} from '@/lib/prediction-accuracy';
import type { AnySupabaseClient } from '@/lib/supabase/types';

export type { AccuracySummary };
export { accuracySummaryLine };

export interface AiAccuracyResult {
  /** The accuracy summary (empty / "not enough history yet" when nothing is recorded). */
  summary: AccuracySummary;
  /** True when the `prediction_outcomes` table does not exist yet (migration 032 unapplied). */
  tableMissing: boolean;
  /** Non-missing-table read error message, when the read failed for another reason. */
  error?: string;
}

function isMissingTableError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return (
    error.code === '42P01' ||
    error.code === 'PGRST205' ||
    /could not find the table/i.test(error.message ?? '')
  );
}

/**
 * Read recorded prediction outcomes and summarize them. Never
 * throws: every failure path returns the honest empty summary
 * with the reason flagged, so a dashboard is never broken by an
 * unapplied migration.
 */
export async function getAiAccuracySummary(
  supabase: AnySupabaseClient
): Promise<AiAccuracyResult> {
  try {
    const { data, error } = await supabase
      .from('prediction_outcomes')
      .select('status, horizon_days')
      .order('predicted_at', { ascending: false })
      .limit(1000);
    if (error) {
      if (isMissingTableError(error)) {
        return { summary: summarizeAccuracy([]), tableMissing: true };
      }
      logger.warn('ai-accuracy: prediction_outcomes read failed', {
        error: error.message,
      });
      return {
        summary: summarizeAccuracy([]),
        tableMissing: false,
        error: error.message ?? 'Prediction outcomes could not be read.',
      };
    }
    const known = new Set(['pending', 'correct', 'incorrect', 'expired']);
    const safeRows = ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
      status: (known.has(String(r.status))
        ? String(r.status)
        : 'pending') as 'pending' | 'correct' | 'incorrect' | 'expired',
      horizonDays: Number(r.horizon_days ?? 30),
    }));
    return { summary: summarizeAccuracy(safeRows), tableMissing: false };
  } catch (err) {
    logger.warn('ai-accuracy: prediction_outcomes read threw', {
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      summary: summarizeAccuracy([]),
      tableMissing: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
