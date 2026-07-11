/**
 * API v1 monitoring providers endpoint.
 * GET /api/v1/monitoring/providers — provider health details.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess, internalError } from '@/lib/api/responses';
import { logApiRequest } from '@/lib/api/middleware';
import { getProviderHealth } from '@/services/monitoring';

export async function GET(request: NextRequest) {
  logApiRequest(request, { endpoint: 'monitoring.providers' });

  try {
    const supabase = await createSupabaseServerClient();
    const providers = await getProviderHealth(supabase);

    return apiSuccess(providers);
  } catch {
    return internalError('Failed to fetch provider health');
  }
}
