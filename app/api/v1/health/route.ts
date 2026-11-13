/**
 * API v1 health check endpoint (deep).
 * GET /api/v1/health — returns service status with DB/auth/Stripe checks.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess, internalError, serviceUnavailable } from '@/lib/api/responses';
import { logApiRequest, rateLimitResponse, getClientIp } from '@/lib/api/middleware';
import { logger } from '@/lib/config/logger';
import { checkHealth } from '@/services/health';

import { logApiError } from '@/lib/api/error-logging';
export async function GET(request: NextRequest) {
  // Section 19, item 96: a throw used to yield an unlogged Next 500.
  // The whole handler is wrapped so failures return the generic
  // error envelope instead.
  try {
    logApiRequest(request, { endpoint: 'health' });
    // Rate limit: 300 requests/min per IP (see docs/rate-limits.md).
    const limited = await rateLimitResponse(`health:${getClientIp(request)}`, 300);
    if (limited) return limited;

    const supabase = await createSupabaseServerClient();
    const health = await checkHealth(supabase);

    if (health.status === 'unhealthy') {
      return serviceUnavailable('Service is unhealthy');
    }

    return apiSuccess(health, health.status === 'healthy' ? 200 : 503);
  } catch (err) {
    logApiError(err, { request, route: 'health', status: 500 });
    logger.error('health: unexpected error', {
      error: err instanceof Error ? err.message : 'unknown',
    });
    return internalError('Health check failed');
  }
}
