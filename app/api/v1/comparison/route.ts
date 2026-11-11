/**
 * API v1 product comparison endpoint.
 * POST /api/v1/comparison — compare 2–5 products across retailers with AI summary.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess, badRequest, internalError } from '@/lib/api/responses';
import { logApiRequest, rateLimitResponse, getClientIp } from '@/lib/api/middleware';
import { getCachedComparison } from '@/services/ai-comparison';
import {
  buildGeoAffiliateUrl,
  isGeoAffiliateEnabled,
  resolveGeoCountry,
} from '@/services/affiliate-geo';

export async function POST(request: NextRequest) {
  logApiRequest(request, { endpoint: 'comparison' });

  // Public AI comparison is read-only compute; cap per IP.
  // Redis-backed when Upstash is configured, in-memory fallback otherwise.
  const limited = await rateLimitResponse(`comparison:${getClientIp(request)}`, 30);
  if (limited) return limited;

  try {
    const body = await request.json();
    const { productIds } = body ?? {};

    if (
      !Array.isArray(productIds) ||
      productIds.length < 2 ||
      productIds.length > 5 ||
      !productIds.every((id) => typeof id === 'string')
    ) {
      return badRequest('productIds must be an array of 2 to 5 product IDs');
    }

    const supabase = await createSupabaseServerClient();
    const comparison = await getCachedComparison(supabase, productIds);

    if (!comparison) {
      return badRequest('Unable to compare the provided products');
    }

    // Section 14, Chunk 1 — merchant outbound links: transform each
    // retailer's URL through the geo affiliate engine AFTER the
    // cache lookup, so no country's tag is ever baked into the
    // cached comparison. Same pattern as the product merchants
    // route: country from the Vercel geo header, then the saved
    // region cookie, then the US fallback. ENV-GATED: with no tag /
    // publisher id configured, buildGeoAffiliateUrl returns every
    // URL unchanged, so today's plain retailer links are untouched
    // and no tag is ever hardcoded here.
    const country = resolveGeoCountry(
      request.headers.get('x-vercel-ip-country'),
      request.cookies.get('sb-country')?.value ?? null
    );
    const withAffiliateLinks = {
      ...comparison,
      products: comparison.products.map((product) => ({
        ...product,
        retailers: product.retailers.map((retailer) => ({
          ...retailer,
          url: buildGeoAffiliateUrl(retailer.url, country),
        })),
      })),
    };

    // affiliateEnabled drives the on-page disclosure note only; tag
    // values themselves are never exposed through this endpoint.
    return apiSuccess(withAffiliateLinks, 200, {
      affiliateEnabled: isGeoAffiliateEnabled(),
    });
  } catch {
    return internalError('Failed to generate product comparison');
  }
}
