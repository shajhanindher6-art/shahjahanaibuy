/**
 * API v1 incidents endpoint.
 * GET /api/v1/monitoring/incidents — public incident history.
 *
 * Incidents are human-recorded rows in `uptime_incidents`
 * (migration 032). An empty list means no incidents have been
 * recorded — it is not a claim that nothing ever went wrong before
 * monitoring started (10 November 2026). A query ERROR (migration
 * not run / DB down) is monitoring itself down: the endpoint
 * answers 503, not a 200 with an empty list (Section 18, Phase 2
 * — item 49).
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess, serviceUnavailable } from '@/lib/api/responses';
import { logApiRequest, rateLimitResponse, getClientIp } from '@/lib/api/middleware';
import { logApiError } from '@/lib/api/error-logging';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const startedAt = Date.now();
  logApiRequest(request, { endpoint: 'monitoring.incidents' });

  const limited = await rateLimitResponse(
    `monitoring-incidents:${getClientIp(request)}`,
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
      .from('uptime_incidents')
      .select('id, started_at, resolved_at, title, status, description')
      .order('started_at', { ascending: false })
      .limit(limit);

    // Section 18, Phase 2 — item 49 (audit §1 #34): a query
    // ERROR (missing table / DB failure) means monitoring itself
    // is down — answer 503. A query that succeeds with no rows is
    // the honest "no incidents recorded" case → 200 with [].
    if (error) {
      logApiError(error, {
        request,
        route: 'monitoring.incidents',
        status: 503,
        startedAt,
      });
      return serviceUnavailable('Monitoring data is unavailable');
    }
    return apiSuccess(data ?? []);
  } catch (err) {
    logApiError(err, {
      request,
      route: 'monitoring.incidents',
      status: 503,
      startedAt,
    });
    return serviceUnavailable('Monitoring data is unavailable');
  }
}
