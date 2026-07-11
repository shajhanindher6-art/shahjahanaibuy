/**
 * API v1 alert history endpoint.
 * GET /api/v1/alerts/history — list the authenticated user's triggered alert history.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess, internalError } from '@/lib/api/responses';
import { logApiRequest, requireAuth } from '@/lib/api/middleware';
import { getAlertHistory } from '@/services/alert-history';

export async function GET(request: NextRequest) {
  logApiRequest(request, { endpoint: 'alerts.history' });

  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  try {
    const { searchParams } = request.nextUrl;
    const limit = Math.min(100, Math.max(1, Number(searchParams.get('limit') ?? 20)));

    const supabase = await createSupabaseServerClient();
    const history = await getAlertHistory(supabase, auth.userId, limit);

    return apiSuccess(history, 200);
  } catch {
    return internalError('Failed to fetch alert history');
  }
}
