/**
 * API v1 health check endpoint (deep).
 * GET /api/v1/health — returns service status with DB/auth/Stripe checks.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess, serviceUnavailable } from '@/lib/api/responses';
import { logApiRequest } from '@/lib/api/middleware';
import { checkHealth } from '@/services/health';

export async function GET(request: NextRequest) {
  logApiRequest(request, { endpoint: 'health' });

  const supabase = await createSupabaseServerClient();
  const health = await checkHealth(supabase);

  if (health.status === 'unhealthy') {
    return serviceUnavailable('Service is unhealthy');
  }

  return apiSuccess(health, health.status === 'healthy' ? 200 : 200);
}
