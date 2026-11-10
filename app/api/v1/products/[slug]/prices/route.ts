/**
 * API v1 product price history endpoint.
 * GET /api/v1/products/[slug]/prices — price history for a product.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess, notFound, internalError } from '@/lib/api/responses';
import { logApiRequest, rateLimitResponse, getClientIp } from '@/lib/api/middleware';
import { getCachedProductBySlug } from '@/services/products';
import { getCachedPriceHistory } from '@/services/price-history';

export async function GET(
  request: NextRequest,
  { params }: { params: { slug: string } }
) {
  logApiRequest(request, { endpoint: 'products.prices', slug: params.slug });
  // Rate limit: 120 requests/min per IP (see docs/rate-limits.md).
  const limited = await rateLimitResponse(`products.slug.prices:${getClientIp(request)}`, 120);
  if (limited) return limited;

  try {
    const { searchParams } = request.nextUrl;
    const retailerId = searchParams.get('retailerId') ?? undefined;
    const limit = searchParams.get('limit')
      ? Math.min(500, Math.max(1, Number(searchParams.get('limit'))))
      : 100;

    const supabase = await createSupabaseServerClient();
    const product = await getCachedProductBySlug(supabase, params.slug);

    if (!product) {
      return notFound('Product not found');
    }

    const history = await getCachedPriceHistory(supabase, product.id, {
      retailerId,
      limit,
    });

    return apiSuccess(history);
  } catch {
    return internalError('Failed to fetch price history');
  }
}
