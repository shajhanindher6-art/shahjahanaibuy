/**
 * API v1 price prediction endpoint.
 * GET /api/v1/predictions/[productId] — AI price-drop prediction for a product.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess, notFound, internalError } from '@/lib/api/responses';
import { logApiRequest, rateLimitResponse, getClientIp } from '@/lib/api/middleware';
import { logApiError } from '@/lib/api/error-logging';
import { predictPriceDrop } from '@/services/ai-predictions';
import { getProductById, getProductBySlug } from '@/services/products';

// Section 14, Chunk 1 — live per-request data: never statically prerendered.
export const dynamic = 'force-dynamic';
// Section 19, Phase 1 (§12 #10) — expensive inline AI work runs under
// maxDuration 60 (matching the 5 cron routes), not the platform default.
export const maxDuration = 60;

export async function GET(
  request: NextRequest,
  { params }: { params: { productId: string } }
) {
  logApiRequest(request, { endpoint: 'predictions', productId: params.productId });
  const startedAt = Date.now();
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
  } catch (err) {
    logApiError(err, { request, route: 'predictions', status: 500, startedAt });
    return internalError('Failed to generate price prediction');
  }
}
