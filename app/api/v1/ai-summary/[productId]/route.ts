/**
 * API v1 AI product summary endpoint.
 * GET /api/v1/ai-summary/[productId] — AI-generated summary with pros, cons, and alternatives.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess, notFound, internalError } from '@/lib/api/responses';
import { logApiRequest, rateLimitResponse, getClientIp } from '@/lib/api/middleware';
import { getProductById, getProductBySlug } from '@/services/products';
import { getAISummary } from '@/services/ai-summary';

// Section 14, Chunk 1 — live per-request data: never statically prerendered.
export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: { productId: string } }
) {
  logApiRequest(request, { endpoint: 'ai-summary', productId: params.productId });
  // Rate limit: 120 requests/min per IP (see docs/rate-limits.md).
  const limited = await rateLimitResponse(`ai-summary.productId:${getClientIp(request)}`, 120);
  if (limited) return limited;

  try {
    const supabase = await createSupabaseServerClient();
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(params.productId);
    const product = isUuid
      ? await getProductById(supabase, params.productId)
      : await getProductBySlug(supabase, params.productId);

    if (!product) {
      return notFound('Product not found');
    }

    const summary = await getAISummary(supabase, product);

    if (!summary) {
      return notFound('Unable to generate AI summary');
    }

    return apiSuccess(summary, 200);
  } catch {
    return internalError('Failed to generate AI summary');
  }
}
