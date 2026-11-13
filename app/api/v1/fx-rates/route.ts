/**
 * API v1 FX rates endpoint — Option 11, Phase 1.
 * GET /api/v1/fx-rates — daily USD rates (live feed when reachable,
 * approximate static fallback otherwise). Public, no auth: rates are
 * public data, and the response always states its source so clients
 * can label live vs approximate conversions honestly.
 */

import type { NextRequest } from 'next/server';
import { apiSuccess, internalError } from '@/lib/api/responses';
import { logApiRequest, rateLimitResponse, getClientIp } from '@/lib/api/middleware';
import { getFxRates } from '@/services/fx-rates';

import { logApiError } from '@/lib/api/error-logging';
export async function GET(request: NextRequest) {
  logApiRequest(request, { endpoint: 'fx-rates' });
  // Rate limit: 120 requests/min per IP (see docs/rate-limits.md).
  const limited = await rateLimitResponse(`fx-rates:${getClientIp(request)}`, 120);
  if (limited) return limited;

  try {
    const fx = await getFxRates();
    return apiSuccess(
      {
        base: fx.base,
        rates: fx.rates,
        source: fx.source,
        fetchedAt: fx.fetchedAt,
        provider: fx.provider,
      },
      200
    );
  } catch (err) {
    logApiError(err, { request, route: 'fx-rates', status: 500 });
    return internalError('Failed to fetch FX rates');
  }
}
