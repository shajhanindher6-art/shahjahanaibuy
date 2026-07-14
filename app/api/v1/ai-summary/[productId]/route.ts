/**
 * API v1 AI product summary endpoint.
 * GET /api/v1/ai-summary/[productId] — AI-generated summary with pros, cons, and alternatives.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess, notFound, internalError } from '@/lib/api/responses';
import { logApiRequest } from '@/lib/api/middleware';
import { getProductById, getProductBySlug } from '@/services/products';
import { getAISummary } from '@/services/ai-summary';

export async function GET(
  request: NextRequest,
  { params }: { params: { productId: string } }
) {
  logApiRequest(request, { endpoint: 'ai-summary', productId: params.productId });

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
