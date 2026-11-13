/**
 * API v1 prediction accuracy endpoint.
 * GET /api/v1/predictions/accuracy — public accuracy summary.
 *
 * Returns the AccuracySummary from lib/prediction-accuracy, computed
 * over the recorded rows in `prediction_outcomes`. Until enough
 * outcomes have resolved the summary honestly says "not enough
 * history yet" — no percentage is invented. Fail-safe: when the
 * migration has not been run (or the query fails) the endpoint
 * returns the honest empty summary instead of a 500.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess } from '@/lib/api/responses';
import { logApiRequest, rateLimitResponse, getClientIp } from '@/lib/api/middleware';
import {
  summarizeAccuracy,
  type AccuracyOutcomeRow,
} from '@/lib/prediction-accuracy';

export const dynamic = 'force-dynamic';
// Section 19, Phase 1 (§12 #10) — expensive inline AI work runs under
// maxDuration 60 (matching the 5 cron routes), not the platform default.
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  logApiRequest(request, { endpoint: 'predictions.accuracy' });
  // Section 19, Phase 9 (§12 #92) — intentionally unwired: the honest empty summary IS the designed response while migration 032 is unapplied (missing table is the expected state, not an error); the endpoint never returns a 5xx.

  const limited = await rateLimitResponse(
    `predictions-accuracy:${getClientIp(request)}`,
    60
  );
  if (limited) return limited;

  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from('prediction_outcomes')
      .select('status, horizon_days')
      .order('predicted_at', { ascending: false })
      .limit(1000);

    // Table missing (migration 032 not run yet) or any query failure:
    // honest empty summary, not an error page.
    if (error || !data) {
      return apiSuccess(summarizeAccuracy([]));
    }

    const rows: AccuracyOutcomeRow[] = (data as Array<Record<string, unknown>>).map((r) => ({
      status: r.status as AccuracyOutcomeRow['status'],
      horizonDays: Number(r.horizon_days ?? 30),
    }));

    return apiSuccess(summarizeAccuracy(rows));
  } catch {
    return apiSuccess(summarizeAccuracy([]));
  }
}
