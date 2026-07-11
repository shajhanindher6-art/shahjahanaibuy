/**
 * API v1 monitoring sync history endpoint.
 * GET /api/v1/monitoring/sync-history — sync history log.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess, internalError } from '@/lib/api/responses';
import { logApiRequest } from '@/lib/api/middleware';
import { getSyncHistory } from '@/services/monitoring';

export async function GET(request: NextRequest) {
  logApiRequest(request, { endpoint: 'monitoring.sync-history' });

  try {
    const { searchParams } = request.nextUrl;
    const limit = searchParams.get('limit')
      ? Math.min(200, Math.max(1, Number(searchParams.get('limit'))))
      : 50;

    const supabase = await createSupabaseServerClient();
    const history = await getSyncHistory(supabase, limit);

    return apiSuccess(history);
  } catch {
    return internalError('Failed to fetch sync history');
  }
}
