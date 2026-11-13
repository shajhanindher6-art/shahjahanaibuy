/**
 * VAPID public key endpoint.
 * GET /api/v1/push/vapid — returns the VAPID public key for the browser.
 */

import { apiSuccess, internalError } from '@/lib/api/responses';
import { logApiRequest, rateLimitResponse, getClientIp } from '@/lib/api/middleware';
import { logger } from '@/lib/config/logger';
import { getVapidPublicKey } from '@/services/push';
import type { NextRequest } from 'next/server';

import { logApiError } from '@/lib/api/error-logging';
export async function GET(request: NextRequest) {
  // Section 19, item 96: a throw used to yield an unlogged Next 500.
  // The whole handler is wrapped so failures return the generic
  // error envelope instead.
  try {
    logApiRequest(request, { endpoint: 'push.vapid' });
    // Rate limit: 120 requests/min per IP (see docs/rate-limits.md).
    const limited = await rateLimitResponse(`push.vapid:${getClientIp(request)}`, 120);
    if (limited) return limited;

    const key = getVapidPublicKey();
    return apiSuccess({ publicKey: key });
  } catch (err) {
    logApiError(err, { request, route: 'push.vapid', status: 500 });
    logger.error('push.vapid: unexpected error', {
      error: err instanceof Error ? err.message : 'unknown',
    });
    return internalError('Could not load the VAPID public key');
  }
}
