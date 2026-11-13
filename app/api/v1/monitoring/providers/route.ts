/**
 * API v1 monitoring providers endpoint.
 * GET /api/v1/monitoring/providers — provider health details.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess, internalError } from '@/lib/api/responses';
import { logApiRequest, requireAdmin, rateLimitResponse, getClientIp } from '@/lib/api/middleware';
import { getProviderHealth } from '@/services/monitoring';

import { logApiError } from '@/lib/api/error-logging';
export async function GET(request: NextRequest) {
  logApiRequest(request, { endpoint: 'monitoring.providers' });
  // Rate limit: 120 requests/min per IP (see docs/rate-limits.md).
  const limited = await rateLimitResponse(`monitoring.providers:${getClientIp(request)}`, 120);
  if (limited) return limited;

  // Admin-only (security fix 2026-11-05): provider health is internal
  // ops data — no reason to be public.
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;

  try {
    const supabase = await createSupabaseServerClient();
    const providers = await getProviderHealth(supabase);

    return apiSuccess(providers);
  } catch (err) {
    logApiError(err, { request, route: 'monitoring.providers', status: 500 });
    return internalError('Failed to fetch provider health');
  }
}
