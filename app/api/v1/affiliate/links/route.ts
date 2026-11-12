/**
 * API v1 affiliate links endpoint.
 * GET /api/v1/affiliate/links — list active affiliate links for a product.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess, badRequest, internalError } from '@/lib/api/responses';
import { logApiRequest, rateLimitResponse, getClientIp } from '@/lib/api/middleware';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  logApiRequest(request, { endpoint: 'affiliate.links' });
  // Rate limit: 120 requests/min per IP (see docs/rate-limits.md).
  const limited = await rateLimitResponse(`affiliate.links:${getClientIp(request)}`, 120);
  if (limited) return limited;

  try {
    const { searchParams } = request.nextUrl;
    const productId = searchParams.get('productId');

    if (!productId || productId.trim() === '') {
      return badRequest('productId is required');
    }

    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from('affiliate_links')
      .select('*')
      .eq('product_id', productId)
      .eq('active', true)
      .order('created_at', { ascending: false });

    if (error) {
      return internalError('Failed to fetch affiliate links');
    }

    return apiSuccess(data ?? []);
  } catch {
    return internalError('Failed to fetch affiliate links');
  }
}
