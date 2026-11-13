/**
 * API v1 admin analytics endpoint.
 * GET /api/v1/admin/analytics — aggregate platform analytics (admin only).
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess, internalError } from '@/lib/api/responses';
import { logApiRequest, requireAdmin, rateLimitResponse, getClientIp } from '@/lib/api/middleware';
import { getAdminAnalytics } from '@/services/admin';

import { logApiError } from '@/lib/api/error-logging';
export async function GET(request: NextRequest) {
  logApiRequest(request, { endpoint: 'admin.analytics' });
  // Rate limit: 60 requests/min per IP (see docs/rate-limits.md).
  const limited = await rateLimitResponse(`admin.analytics:${getClientIp(request)}`, 60);
  if (limited) return limited;

  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;

  try {
    const supabase = await createSupabaseServerClient();
    const analytics = await getAdminAnalytics(supabase);

    return apiSuccess(analytics, 200);
  } catch (err) {
    logApiError(err, { request, route: 'admin.analytics', status: 500 });
    return internalError('Failed to fetch admin analytics');
  }
}
