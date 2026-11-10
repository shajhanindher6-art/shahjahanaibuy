/**
 * Local-first retailer search endpoint (public read, no auth).
 * GET /api/search?q=<query>
 *
 * Resolves the visitor's country (x-vercel-ip-country header,
 * then the saved sb-country cookie, then US — same precedence as
 * the affiliate engine's resolver) and splits results into two
 * buckets:
 *   - localResults: the country's CONFIRMED local stores
 *     (lib/stores.ts), as search links only — never a price,
 *     stock state, discount, deal, or rating.
 *   - globalResults: catalog product matches (real recorded
 *     prices only, via the exact product-query logic of the
 *     ai-search route) followed by global store links. Each
 *     entry is honestly typed ('product' vs 'store-link').
 * fallbackTriggered is true when the country has no confirmed
 * local store (e.g. ZA) — the UI then auto-switches to the
 * Global tab with the fallback notice.
 *
 * A catalog/DB failure returns no products — never a crash and
 * never an invented price; the global store links still render.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess, badRequest, internalError } from '@/lib/api/responses';
import { logApiRequest, rateLimitResponse, getClientIp } from '@/lib/api/middleware';
import { FALLBACK_REGION, getRegionByCountry } from '@/lib/region';
import { resolveGeoCountry } from '@/services/affiliate-geo';
import { getCachedAISearch } from '@/services/ai-search';
import {
  buildLocalFirstResults,
  validateLocalFirstQuery,
  type CatalogProductForLocalFirst,
  type LocalFirstSearchData,
} from '@/services/local-first-search';

export async function GET(request: NextRequest) {
  logApiRequest(request, { endpoint: 'search' });
  // Rate limit: 60 requests/min per IP (see docs/rate-limits.md).
  const limited = await rateLimitResponse(`search:${getClientIp(request)}`, 60);
  if (limited) return limited;

  const validated = validateLocalFirstQuery(request.nextUrl.searchParams.get('q'));
  if (!validated.ok) return badRequest(validated.error);
  const query = validated.query;

  try {
    const country = resolveGeoCountry(
      request.headers.get('x-vercel-ip-country'),
      request.cookies.get('sb-country')?.value ?? null
    );
    const region = getRegionByCountry(country) ?? FALLBACK_REGION;

    // Catalog matches reuse the exact product-query logic of the
    // ai-search route (same cached search, same latest-price
    // lookup). A failure here is contained: products stay empty
    // and the global store links below still render.
    let products: CatalogProductForLocalFirst[] = [];
    try {
      const supabase = await createSupabaseServerClient();
      const result = await getCachedAISearch(supabase, { query, pageSize: 10 });
      products = result.results.map((r) => ({
        id: r.product.id,
        name: r.product.name,
        slug: r.product.slug,
        brand: r.product.brand,
        category: r.product.category,
        imageUrl: r.product.imageUrl,
        currentPrice: r.currentPrice,
        score: r.score,
        stores: r.stores ?? [],
      }));
    } catch {
      products = [];
    }

    const { localResults, globalResults, fallbackTriggered } = buildLocalFirstResults({
      query,
      country,
      products,
    });

    const data: LocalFirstSearchData = {
      query,
      country,
      countryName: region.name,
      currency: region.currency,
      localResults,
      globalResults,
      fallbackTriggered,
    };
    return apiSuccess(data);
  } catch {
    return internalError('Failed to perform local-first search');
  }
}
