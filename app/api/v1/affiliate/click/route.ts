/**
 * API v1 affiliate click tracking endpoint.
 * POST /api/v1/affiliate/click — record an affiliate link click.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess, badRequest, internalError } from '@/lib/api/responses';
import { logApiRequest, rateLimitResponse, getClientIp } from '@/lib/api/middleware';

import { logApiError } from '@/lib/api/error-logging';
export async function POST(request: NextRequest) {
  logApiRequest(request, { endpoint: 'affiliate.click' });
  // Rate limit: 60 requests/min per IP (see docs/rate-limits.md).
  const limited = await rateLimitResponse(`affiliate.click:${getClientIp(request)}`, 60);
  if (limited) return limited;

  try {
    const body = await request.json();
    const { affiliateLinkId, productId, retailerName, clickedPrice } = body ?? {};

    if (typeof affiliateLinkId !== 'string' || affiliateLinkId.trim() === '') {
      return badRequest('affiliateLinkId is required');
    }

    const supabase = await createSupabaseServerClient();

    // Insert the click event.
    const { error: insertError } = await supabase
      .from('affiliate_clicks')
      .insert({
        affiliate_link_id: affiliateLinkId,
        product_id: typeof productId === 'string' ? productId : null,
        retailer_name: typeof retailerName === 'string' ? retailerName : null,
        clicked_price: typeof clickedPrice === 'number' ? clickedPrice : null,
      });

    if (insertError) {
      return internalError('Failed to track affiliate click');
    }

    // Increment the click counter on the affiliate link.
    await supabase.rpc('increment_affiliate_clicks', {
      link_id: affiliateLinkId,
    });

    return apiSuccess({ tracked: true });
  } catch (err) {
    logApiError(err, { request, route: 'affiliate.click', status: 500 });
    return internalError('Failed to track affiliate click');
  }
}
