/**
 * API v1 monitoring summary endpoint.
 * GET /api/v1/monitoring — provider health, sync history, queue metrics, product counts.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess, internalError } from '@/lib/api/responses';
import { logApiRequest, requireAdmin, rateLimitResponse, getClientIp } from '@/lib/api/middleware';
import { getMonitoringSummary } from '@/services/monitoring';

export async function GET(request: NextRequest) {
  logApiRequest(request, { endpoint: 'monitoring' });
  // Rate limit: 120 requests/min per IP (see docs/rate-limits.md).
  const limited = await rateLimitResponse(`monitoring:${getClientIp(request)}`, 120);
  if (limited) return limited;

  // Admin-only (security fix 2026-11-05): provider health, sync history
  // and queue metrics are internal ops data — no reason to be public.
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;

  try {
    const supabase = await createSupabaseServerClient();
    const summary = await getMonitoringSummary(supabase);

    return apiSuccess(summary);
  } catch {
    return internalError('Failed to fetch monitoring summary');
  }
}
