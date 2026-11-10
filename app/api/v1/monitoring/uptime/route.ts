/**
 * API v1 uptime summary endpoint.
 * GET /api/v1/monitoring/uptime — public uptime + status summary.
 *
 * Data comes only from recorded rows in `uptime_checks` /
 * `uptime_incidents` (migration 032). Before checks accrue the
 * response honestly says monitoring started with no checks recorded
 * yet — uptimePercent is null, never an invented number. Fail-safe:
 * when the migration has not been run the endpoint still returns
 * the honest empty summary instead of a 500.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess } from '@/lib/api/responses';
import { logApiRequest, rateLimitResponse, getClientIp } from '@/lib/api/middleware';
import { buildStatusSummary, type StatusIncident } from '@/lib/status';
import type { UptimeCheckRow } from '@/lib/uptime';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
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

    // Migration not run yet → honest empty summary.
    const checks = (
      checksRes.error || !checksRes.data ? [] : checksRes.data
    ) as unknown as UptimeCheckRow[];
    const incidents = (
      incidentsRes.error || !incidentsRes.data ? [] : incidentsRes.data
    ) as unknown as StatusIncident[];

    return apiSuccess(buildStatusSummary(checks, incidents, windowDays));
  } catch {
    return apiSuccess(buildStatusSummary([], []));
  }
}
