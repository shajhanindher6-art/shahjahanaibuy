/**
 * API v1 monitoring summary endpoint.
 * GET /api/v1/monitoring — provider health, sync history, queue metrics, product counts.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess, internalError } from '@/lib/api/responses';
import { logApiRequest } from '@/lib/api/middleware';
import { getMonitoringSummary } from '@/services/monitoring';

export async function GET(request: NextRequest) {
  logApiRequest(request, { endpoint: 'monitoring' });

  try {
    const supabase = await createSupabaseServerClient();
    const summary = await getMonitoringSummary(supabase);

    return apiSuccess(summary);
  } catch {
    return internalError('Failed to fetch monitoring summary');
  }
}
