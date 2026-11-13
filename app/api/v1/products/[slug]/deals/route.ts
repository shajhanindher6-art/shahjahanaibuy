/**
 * API v1 product deals endpoint.
 * GET /api/v1/products/[slug]/deals — active deals for a product.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess, notFound, internalError } from '@/lib/api/responses';
import { logApiRequest, rateLimitResponse, getClientIp } from '@/lib/api/middleware';
import { getCachedProductBySlug } from '@/services/products';
import { getDeals } from '@/services/commerce';

import { logApiError } from '@/lib/api/error-logging';
// Section 14, Chunk 1 — live per-request data: never statically prerendered.
export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: { slug: string } }
) {
  logApiRequest(request, { endpoint: 'products.deals', slug: params.slug });
  // Rate limit: 120 requests/min per IP (see docs/rate-limits.md).
  const limited = await rateLimitResponse(`products.slug.deals:${getClientIp(request)}`, 120);
  if (limited) return limited;

  try {
    const { searchParams } = request.nextUrl;
    const limit = searchParams.get('limit')
      ? Math.min(200, Math.max(1, Number(searchParams.get('limit'))))
      : 50;

    const supabase = await createSupabaseServerClient();
    const product = await getCachedProductBySlug(supabase, params.slug);

    if (!product) {
      return notFound('Product not found');
    }

    const deals = await getDeals(supabase, {
      productId: product.id,
      active: true,
      limit,
    });

    return apiSuccess(deals);
  } catch (err) {
    logApiError(err, { request, route: 'products.deals', status: 500 });
    return internalError('Failed to fetch deals');
  }
}
