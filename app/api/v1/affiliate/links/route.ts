/**
 * API v1 affiliate links endpoint.
 * GET /api/v1/affiliate/links — list active affiliate links for a product.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess, badRequest, internalError } from '@/lib/api/responses';
import { logApiRequest, rateLimitResponse, getClientIp } from '@/lib/api/middleware';

import { logApiError } from '@/lib/api/error-logging';
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
    // Section 18, item 30 — explicit columns (was select('*')):
    // the rows are returned verbatim, so the list must cover every
    // column of affiliate_links (migration 009).
    const { data, error } = await supabase
      .from('affiliate_links')
      .select('id, product_id, retailer_id, merchant_id, retailer_name, original_url, affiliate_url, affiliate_id, commission_rate, clicks_count, conversions_count, revenue_generated, active, created_at, updated_at')
      .eq('product_id', productId)
      .eq('active', true)
      .order('created_at', { ascending: false });

    if (error) {
      return internalError('Failed to fetch affiliate links');
    }

    return apiSuccess(data ?? []);
  } catch (err) {
    logApiError(err, { request, route: 'affiliate.links', status: 500 });
    return internalError('Failed to fetch affiliate links');
  }
}
