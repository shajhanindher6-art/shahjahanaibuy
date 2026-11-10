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

export async function GET(request: NextRequest) {
  logApiRequest(request, { endpoint: 'predictions.accuracy' });

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
