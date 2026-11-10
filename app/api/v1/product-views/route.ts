/**
 * API v1 product views endpoint.
 * POST /api/v1/product-views — record that the authenticated user viewed a product.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess, badRequest, internalError } from '@/lib/api/responses';
import { logApiRequest, requireAuth, rateLimitResponse, getClientIp } from '@/lib/api/middleware';

export async function POST(request: NextRequest) {
  logApiRequest(request, { endpoint: 'product-views' });
  // Rate limit: 60 requests/min per IP (see docs/rate-limits.md).
  const limited = await rateLimitResponse(`product-views:${getClientIp(request)}`, 60);
  if (limited) return limited;

  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  try {
    const body = await request.json();
    const { productId } = body ?? {};

    if (typeof productId !== 'string' || productId.trim() === '') {
      return badRequest('productId is required');
    }

    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.from('product_views').insert({
      user_id: auth.userId,
      product_id: productId,
    });

    if (error) {
      return internalError('Failed to record product view');
    }

    return apiSuccess({ recorded: true }, 201);
  } catch {
    return internalError('Failed to record product view');
  }
}
