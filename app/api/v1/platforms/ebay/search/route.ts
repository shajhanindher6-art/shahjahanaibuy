/**
 * Section 8 — live eBay search endpoint (public read, no auth).
 * GET /api/v1/platforms/ebay/search?q=<query>&limit=<1-10>
 *
 * Returns live eBay ACTIVE listings (asking prices) from the
 * official Browse API — cheapest first. When eBay is not
 * configured (no EBAY_CLIENT_ID / EBAY_CLIENT_SECRET in Vercel),
 * the response is still 200 with `configured: false` and an empty
 * list, so the UI can render its honest "not configured" state
 * instead of an error. An upstream eBay failure is a 503, never
 * a fake or cached listing.
 *
 * Listings carry no price history, no Deal Score, and no "lowest
 * ever" claim — they are the sellers' asking prices at call time.
 */

import type { NextRequest } from 'next/server';
import {
  apiSuccess,
  badRequest,
  serviceUnavailable,
} from '@/lib/api/responses';
import {
  logApiRequest,
  rateLimitResponse,
  getClientIp,
} from '@/lib/api/middleware';
import {
  isEbayConfigured,
  searchEbayListings,
} from '@/services/ebay-browse';
import { validateLocalFirstQuery } from '@/services/local-first-search';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  logApiRequest(request, { endpoint: 'platforms.ebay-search' });
  // Rate limit: 30 requests/min per IP — eBay's free tier is
  // 5,000 calls/day, so this cap keeps one visitor from spending
  // the whole budget.
  const limited = await rateLimitResponse(
    `platforms.ebay-search:${getClientIp(request)}`,
    30
  );
  if (limited) return limited;

  const validated = validateLocalFirstQuery(
    request.nextUrl.searchParams.get('q')
  );
  if (!validated.ok) return badRequest(validated.error);

  const rawLimit = request.nextUrl.searchParams.get('limit');
  const parsedLimit = rawLimit ? Number.parseInt(rawLimit, 10) : undefined;
  const limit = Number.isFinite(parsedLimit) ? parsedLimit : undefined;

  const result = await searchEbayListings(validated.query, { limit });
  if (!result.ok && result.reason === 'api-error') {
    return serviceUnavailable(
      'eBay is temporarily unavailable. Try again later.'
    );
  }
  return apiSuccess({
    configured: isEbayConfigured(),
    source: result.ok ? result.source : result.reason,
    listings: result.listings,
  });
}
