/**
 * API v1 incidents endpoint.
 * GET /api/v1/monitoring/incidents — public incident history.
 *
 * Incidents are human-recorded rows in `uptime_incidents`
 * (migration 032). An empty list means no incidents have been
 * recorded — it is not a claim that nothing ever went wrong before
 * monitoring started (10 November 2026). Fail-safe: when the
 * migration has not been run the endpoint returns an honest empty
 * list instead of a 500.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess } from '@/lib/api/responses';
import { logApiRequest, rateLimitResponse, getClientIp } from '@/lib/api/middleware';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
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

    if (error || !data) return apiSuccess([]);
    return apiSuccess(data);
  } catch {
    return apiSuccess([]);
  }
}
