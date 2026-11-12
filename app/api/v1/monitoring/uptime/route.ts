/**
 * API v1 uptime summary endpoint.
 * GET /api/v1/monitoring/uptime — public uptime + status summary.
 *
 * Data comes only from recorded rows in `uptime_checks` /
 * `uptime_incidents` (migration 032). Before checks accrue the
 * response honestly says monitoring started with no checks recorded
 * yet — uptimePercent is null, never an invented number. But a
 * query ERROR (migration not run / DB down) is monitoring itself
 * down: the endpoint answers 503, not a 200 with an empty summary
 * (Section 18, Phase 2 — item 49).
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess, serviceUnavailable } from '@/lib/api/responses';
import { logApiRequest, rateLimitResponse, getClientIp } from '@/lib/api/middleware';
import { logApiError } from '@/lib/api/error-logging';
import { buildStatusSummary, type StatusIncident } from '@/lib/status';
import type { UptimeCheckRow } from '@/lib/uptime';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const startedAt = Date.now();
  logApiRequest(request, { endpoint: 'monitoring.uptime' });

  const limited = await rateLimitResponse(`monitoring-uptime:${getClientIp(request)}`, 60);
  if (limited) return limited;

  try {
    const supabase = await createSupabaseServerClient();
    const windowDays = Math.min(
      90,
      Math.max(1, Number(request.nextUrl.searchParams.get('days') ?? 90))
    );

    const [checksRes, incidentsRes] = await Promise.all([
      supabase
        .from('uptime_checks')
        .select('checked_at, target_url, status_code, ok, response_ms, error, source')
        .order('checked_at', { ascending: false })
        .limit(2000),
      supabase
        .from('uptime_incidents')
        .select('id, started_at, resolved_at, title, status, description')
        .order('started_at', { ascending: false })
        .limit(50),
    ]);

    // Section 18, Phase 2 — item 49 (audit §1 #34): a query
    // ERROR (missing table / DB failure) means monitoring itself
    // is down — answer 503, never a 200 with an empty summary. A
    // query that succeeds with NO rows is the honest no-data-yet
    // case and still returns the empty summary with 200.
    if (checksRes.error || incidentsRes.error) {
      logApiError(checksRes.error ?? incidentsRes.error, {
        request,
        route: 'monitoring.uptime',
        status: 503,
        startedAt,
      });
      return serviceUnavailable('Monitoring data is unavailable');
    }
    const checks = (checksRes.data ?? []) as unknown as UptimeCheckRow[];
    const incidents = (incidentsRes.data ?? []) as unknown as StatusIncident[];

    return apiSuccess(buildStatusSummary(checks, incidents, windowDays));
  } catch (err) {
    logApiError(err, {
      request,
      route: 'monitoring.uptime',
      status: 503,
      startedAt,
    });
    return serviceUnavailable('Monitoring data is unavailable');
  }
}
