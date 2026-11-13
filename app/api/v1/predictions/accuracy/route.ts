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
import { logApiError } from '@/lib/api/error-logging';
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
  // Section 21–25, Stage J, J-P2-3 — wired: unexpected throws and
  // non-missing-table query failures are logged via logApiError;
  // the honest empty summary below is still returned. A missing
  // table (migration 032 unapplied) is the expected state, not an
  // error, and is deliberately NOT logged.

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
      // Log real query failures; a missing table is expected.
      const code = (error as { code?: string } | null)?.code;
      if (error && code !== 'PGRST205' && code !== '42P01') {
        logApiError(new Error(`predictions accuracy query failed: ${error.message}`), {
          request,
          route: 'predictions-accuracy',
          status: 500,
        });
      }
      return apiSuccess(summarizeAccuracy([]));
    }

    const rows: AccuracyOutcomeRow[] = (data as Array<Record<string, unknown>>).map((r) => ({
      status: r.status as AccuracyOutcomeRow['status'],
      horizonDays: Number(r.horizon_days ?? 30),
    }));

    return apiSuccess(summarizeAccuracy(rows));
  } catch (err) {
    logApiError(err, { request, route: 'predictions-accuracy', status: 500 });
    return apiSuccess(summarizeAccuracy([]));
  }
}
