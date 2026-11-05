/**
 * API v1 product merchant listings endpoint.
 * GET /api/v1/products/[slug]/merchants — merchant listings for a product.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess, notFound, internalError } from '@/lib/api/responses';
import { logApiRequest } from '@/lib/api/middleware';
import { getCachedProductBySlug } from '@/services/products';
import { getMerchantProducts, getMerchants } from '@/services/commerce';
import {
  buildGeoAffiliateUrl,
  isGeoAffiliateEnabled,
  resolveGeoCountry,
} from '@/services/affiliate-geo';

export async function GET(
  request: NextRequest,
  { params }: { params: { slug: string } }
) {
  logApiRequest(request, { endpoint: 'products.merchants', slug: params.slug });

  try {
    const supabase = await createSupabaseServerClient();
    const product = await getCachedProductBySlug(supabase, params.slug);

    if (!product) {
      return notFound('Product not found');
    }

    const listings = await getMerchantProducts(supabase, product.id);

    // Listings carry only a merchantId; a UUID is useless to a
    // shopper, so attach the merchant name here (no existing
    // consumer of this endpoint relied on the bare shape).
    const merchants = await getMerchants(supabase);
    const nameById = new Map(merchants.map((m) => [m.id, m.name]));

    // Phase 3 Prep: geo-targeted affiliate transform, server-side.
    // Country precedence: Vercel geo header, then the visitor's saved
    // region cookie, then the US fallback. ENV-GATED: with no tag /
    // publisher id configured, buildGeoAffiliateUrl returns every URL
    // unchanged, so today's plain search links are untouched.
    const country = resolveGeoCountry(
      request.headers.get('x-vercel-ip-country'),
      request.cookies.get('sb-country')?.value ?? null
    );
    const withNames = listings.map((listing) => ({
      ...listing,
      merchantName: nameById.get(listing.merchantId) ?? null,
      url: buildGeoAffiliateUrl(listing.url, country),
    }));

    // affiliateEnabled drives the on-page disclosure note only; tag
    // values themselves are never exposed through this endpoint.
    return apiSuccess(withNames, 200, {
      affiliateEnabled: isGeoAffiliateEnabled(),
    });
  } catch {
    return internalError('Failed to fetch merchant listings');
  }
}
