/**
 * VAPID public key endpoint.
 * GET /api/v1/push/vapid — returns the VAPID public key for the browser.
 */

import { apiSuccess } from '@/lib/api/responses';
import { logApiRequest } from '@/lib/api/middleware';
import { getVapidPublicKey } from '@/services/push';
import type { NextRequest } from 'next/server';

export async function GET(request: NextRequest) {
  logApiRequest(request, { endpoint: 'push.vapid' });
  const key = getVapidPublicKey();
  return apiSuccess({ publicKey: key });
}
