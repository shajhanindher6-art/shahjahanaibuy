/**
 * API v1 fact-check meaning endpoint (Section 5 #16).
 * GET /api/v1/fact-check/meaning — the PUBLIC meaning of "Verified"
 * for deals, plus the takedown policy. No database, no auth: this is
 * published text, so shoppers always know exactly what the badge
 * does — and does not — mean.
 */

import type { NextRequest } from 'next/server';
import { apiSuccess, internalError } from '@/lib/api/responses';
import { logApiRequest, rateLimitResponse, getClientIp } from '@/lib/api/middleware';
import { logger } from '@/lib/config/logger';
import { DEAL_VERIFIED_MEANING, DEAL_TAKEDOWN_POLICY } from '@/lib/fact-check';

import { logApiError } from '@/lib/api/error-logging';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  // Section 19, item 96: a throw used to yield an unlogged Next 500.
  // The whole handler is wrapped so failures return the generic
  // error envelope instead.
  try {
    logApiRequest(request, { endpoint: 'fact-check.meaning' });

    const limited = await rateLimitResponse(`fact-check-meaning:${getClientIp(request)}`, 60);
    if (limited) return limited;

    return apiSuccess({
      meaning: DEAL_VERIFIED_MEANING,
      takedownPolicy: DEAL_TAKEDOWN_POLICY,
    });
  } catch (err) {
    logApiError(err, { request, route: 'fact-check.meaning', status: 500 });
    logger.error('fact-check.meaning: unexpected error', {
      error: err instanceof Error ? err.message : 'unknown',
    });
    return internalError('Could not load the fact-check meaning');
  }
}
