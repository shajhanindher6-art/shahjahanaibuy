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
    const withNames = listings.map((listing) => ({
      ...listing,
      merchantName: nameById.get(listing.merchantId) ?? null,
    }));

    return apiSuccess(withNames);
  } catch {
    return internalError('Failed to fetch merchant listings');
  }
}
