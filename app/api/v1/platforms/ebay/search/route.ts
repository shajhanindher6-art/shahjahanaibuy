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
  internalError,
  rateLimited,
  serviceUnavailable,
} from '@/lib/api/responses';
import {
  logApiRequest,
  rateLimitResponse,
  getClientIp,
} from '@/lib/api/middleware';
import { logApiError } from '@/lib/api/error-logging';
import {
  isEbayConfigured,
  searchEbayListings,
} from '@/services/ebay-browse';
import {
  reserveEbayDailyCall,
} from '@/services/ebay-budget';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { validateLocalFirstQuery } from '@/services/local-first-search';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  logApiRequest(request, { endpoint: 'platforms.ebay-search' });
  const startedAt = Date.now();

  // Section 19, Phase 9 (§12 #92) — outer try/catch: a throw used
  // to be an unlogged Next 500. Only thrown (5xx) errors are
  // logged; the deliberate 400 (bad query), 429 (daily budget),
  // and 503 (eBay upstream unavailable) below stay unlogged —
  // they are handled states, not server errors.
  try {
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

    // Section 15, P3-5 — GLOBAL daily budget (cap 4,500/day, 90% of
    // the 5,000 free tier). The 30/min/IP limit above does not
    // protect the shared daily budget, so every real eBay call
    // reserves one call first. Unconfigured eBay spends nothing.
    // At the cap: an honest 429 — the UI falls back to the catalog
    // + store search links instead of showing fake listings.
    let budget: Awaited<ReturnType<typeof reserveEbayDailyCall>> | null = null;
    if (isEbayConfigured()) {
      // The DB-counter fallback needs the service client; when it
      // is unavailable the budget module falls back to Redis, and
      // then fails open (allows the call, logs a warning).
      budget = await reserveEbayDailyCall(createSupabaseServiceClient());
      if (!budget.allowed) {
        return rateLimited(
          'eBay daily budget used — try tomorrow. The catalog and store search links still work.',
          {
            budgetRemaining: 0,
            budgetLimit: budget.limit,
            budgetUsed: budget.used,
            fallback: 'catalog',
          }
        );
      }
    }

    const result = await searchEbayListings(validated.query, { limit });
    if (!result.ok && result.reason === 'rate-limited') {
      return rateLimited('eBay rate-limited this request — try again shortly.', {
        budgetRemaining: budget?.remaining ?? null,
        budgetLimit: budget?.limit ?? null,
      });
    }
    if (!result.ok && result.reason === 'api-error') {
      return serviceUnavailable(
        'eBay is temporarily unavailable. Try again later.'
      );
    }
    return apiSuccess({
      configured: isEbayConfigured(),
      source: result.ok ? result.source : result.reason,
      listings: result.listings,
      ...(budget
        ? {
            budget: {
              remaining: budget.remaining,
              used: budget.used,
              limit: budget.limit,
            },
          }
        : {}),
    });
  } catch (err) {
    logApiError(err, { request, route: 'platforms.ebay-search', status: 500, startedAt });
    return internalError('eBay search failed');
  }
}
