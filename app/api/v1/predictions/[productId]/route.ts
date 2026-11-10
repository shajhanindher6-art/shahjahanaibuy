/**
 * API v1 price prediction endpoint.
 * GET /api/v1/predictions/[productId] — AI price-drop prediction for a product.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess, notFound, internalError } from '@/lib/api/responses';
import { logApiRequest, rateLimitResponse, getClientIp } from '@/lib/api/middleware';
import { predictPriceDrop } from '@/services/ai-predictions';
import { getProductById, getProductBySlug } from '@/services/products';

export async function GET(
  request: NextRequest,
  { params }: { params: { productId: string } }
) {
  logApiRequest(request, { endpoint: 'predictions', productId: params.productId });
  // Rate limit: 120 requests/min per IP (see docs/rate-limits.md).
  const limited = await rateLimitResponse(`predictions.productId:${getClientIp(request)}`, 120);
  if (limited) return limited;

  try {
    const supabase = await createSupabaseServerClient();
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(params.productId);
    const resolved = isUuid
      ? await getProductById(supabase, params.productId)
      : await getProductBySlug(supabase, params.productId);

    if (!resolved) {
      return notFound('Product not found');
    }

    const prediction = await predictPriceDrop(supabase, resolved.id);

    if (!prediction) {
      return notFound('No price history available for predictions');
    }

    return apiSuccess(prediction, 200);
  } catch {
    return internalError('Failed to generate price prediction');
  }
}
