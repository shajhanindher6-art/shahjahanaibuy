/**
 * API v1 admin analytics endpoint.
 * GET /api/v1/admin/analytics — aggregate platform analytics (admin only).
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess, internalError } from '@/lib/api/responses';
import { logApiRequest, requireAuth } from '@/lib/api/middleware';
import { getAdminAnalytics } from '@/services/admin';

export async function GET(request: NextRequest) {
  logApiRequest(request, { endpoint: 'admin.analytics' });

  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  try {
    const supabase = await createSupabaseServerClient();
    const analytics = await getAdminAnalytics(supabase);

    return apiSuccess(analytics, 200);
  } catch {
    return internalError('Failed to fetch admin analytics');
  }
}
