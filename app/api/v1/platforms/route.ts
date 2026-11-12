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
import { apiSuccess } from '@/lib/api/responses';
import {
  logApiRequest,
  rateLimitResponse,
  getClientIp,
} from '@/lib/api/middleware';
import { describePlatformStatus } from '@/services/platform-status';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  logApiRequest(request, { endpoint: 'platforms' });
  const limited = await rateLimitResponse(
    `platforms:${getClientIp(request)}`,
    120
  );
  if (limited) return limited;

  return apiSuccess({ platforms: describePlatformStatus() });
}
