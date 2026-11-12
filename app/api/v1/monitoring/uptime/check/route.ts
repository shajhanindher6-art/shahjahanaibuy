/**
 * API v1 uptime check runner.
 * POST /api/v1/monitoring/uptime/check — run one in-app check and
 * record it in `uptime_checks` (migration 032).
 *
 * Auth: Bearer CRON_SECRET (same pattern as /api/v1/prices/refresh)
 * or an admin session. Fail-closed when CRON_SECRET is unset.
 * Schedule exactly ONE free cron job (e.g. cron-job.org, every
 * 5 minutes) against this endpoint — see docs/uptime.md. Do NOT
 * combine it with the 6-hour price-refresh cron.
 *
 * The check itself never throws: a failed fetch is recorded as a
 * down check (ok=false with the error), so a down site leaves
 * evidence instead of a missing row.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { apiSuccess, badRequest, internalError, serviceUnavailable } from '@/lib/api/responses';
import { logApiRequest, rateLimitResponse, getClientIp, requireAdmin } from '@/lib/api/middleware';
import { isCronAuthorized } from '@/lib/api/cron-auth';
import { DEFAULT_UPTIME_TARGET, runUptimeCheck } from '@/lib/uptime';

export const dynamic = 'force-dynamic';

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  logApiRequest(request, { endpoint: 'monitoring.uptime.check' });

  const limited = await rateLimitResponse(
    `monitoring-uptime-check:${getClientIp(request)}`,
    10
  );
  if (limited) return limited;

  if (!isCronAuthorized(request)) {
    const auth = await requireAdmin(request);
    if ('error' in auth) return auth.error;
  }

  const service = createSupabaseServiceClient();
  if (!service) {
    return internalError('Uptime check unavailable: service client not configured');
  }

  try {
    const body = await request.json().catch(() => null);
    const targetUrl =
      typeof body?.target_url === 'string' && body.target_url.trim() !== ''
        ? body.target_url.trim()
        : DEFAULT_UPTIME_TARGET;

    if (!isHttpUrl(targetUrl)) {
      return badRequest('target_url must be an http(s) URL');
    }

    const result = await runUptimeCheck(targetUrl);

    const { data, error } = await service
      .from('uptime_checks')
      .insert({
        target_url: targetUrl,
        status_code: result.statusCode,
        ok: result.ok,
        response_ms: result.responseMs,
        error: result.error,
        source: 'in-app',
      })
      .select('id, checked_at, ok')
      .single();

    if (error) {
      // Most likely the migration has not been run yet.
      return serviceUnavailable(
        'Uptime check ran but could not be recorded (migration 032 may not be run yet)'
      );
    }

    return apiSuccess({ ...data, target_url: targetUrl, status_code: result.statusCode });
  } catch {
    return internalError('Uptime check failed');
  }
}
