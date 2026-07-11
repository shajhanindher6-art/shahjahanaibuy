/**
 * API v1 price prediction endpoint.
 * GET /api/v1/predictions/[productId] — AI price-drop prediction for a product.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess, notFound, internalError } from '@/lib/api/responses';
import { logApiRequest } from '@/lib/api/middleware';
import { predictPriceDrop } from '@/services/ai-predictions';

export async function GET(
  request: NextRequest,
  { params }: { params: { productId: string } }
) {
  logApiRequest(request, { endpoint: 'predictions', productId: params.productId });

  try {
    const supabase = await createSupabaseServerClient();
    const prediction = await predictPriceDrop(supabase, params.productId);

    if (!prediction) {
      return notFound('No price history available for predictions');
    }

    return apiSuccess(prediction, 200);
  } catch {
    return internalError('Failed to generate price prediction');
  }
}
