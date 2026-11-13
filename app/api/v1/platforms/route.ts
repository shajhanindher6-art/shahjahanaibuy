/**
 * Section 8 — platform status endpoint (public read, no auth).
 * GET /api/v1/platforms
 *
 * Returns the honest status of every platform SmartBuy connects
 * to: priced merchants, the eBay live API, search-link retailers,
 * the Skimlinks aggregator, and the local-stores directory. A
 * platform with no configured account is reported as
 * `not-configured` / `search-links-only` —
 * never as "connected". No secret value is ever returned, only
 * booleans, counts, and plain-language notes.
 */

import type { NextRequest } from 'next/server';
import { apiSuccess, internalError } from '@/lib/api/responses';
import {
  logApiRequest,
  rateLimitResponse,
  getClientIp,
} from '@/lib/api/middleware';
import { logger } from '@/lib/config/logger';
import { describePlatformStatus } from '@/services/platform-status';

import { logApiError } from '@/lib/api/error-logging';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  // Section 19, item 96: a throw used to yield an unlogged Next 500.
  // The whole handler is wrapped so failures return the generic
  // error envelope instead.
  try {
    logApiRequest(request, { endpoint: 'platforms' });
    const limited = await rateLimitResponse(
      `platforms:${getClientIp(request)}`,
      120
    );
    if (limited) return limited;

    return apiSuccess({ platforms: describePlatformStatus() });
  } catch (err) {
    logApiError(err, { request, route: 'platforms', status: 500 });
    logger.error('platforms: unexpected error', {
      error: err instanceof Error ? err.message : 'unknown',
    });
    return internalError('Could not load platform status');
  }
}
