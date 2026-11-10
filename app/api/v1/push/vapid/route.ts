/**
 * VAPID public key endpoint.
 * GET /api/v1/push/vapid — returns the VAPID public key for the browser.
 */

import { apiSuccess } from '@/lib/api/responses';
import { logApiRequest, rateLimitResponse, getClientIp } from '@/lib/api/middleware';
import { getVapidPublicKey } from '@/services/push';
import type { NextRequest } from 'next/server';

export async function GET(request: NextRequest) {
  logApiRequest(request, { endpoint: 'push.vapid' });
  // Rate limit: 120 requests/min per IP (see docs/rate-limits.md).
  const limited = await rateLimitResponse(`push.vapid:${getClientIp(request)}`, 120);
  if (limited) return limited;

  const key = getVapidPublicKey();
  return apiSuccess({ publicKey: key });
}
