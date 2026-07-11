/**
 * API v1 affiliate click tracking endpoint.
 * POST /api/v1/affiliate/click — record an affiliate link click.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess, badRequest, internalError } from '@/lib/api/responses';
import { logApiRequest } from '@/lib/api/middleware';

export async function POST(request: NextRequest) {
  logApiRequest(request, { endpoint: 'affiliate.click' });

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
  } catch {
    return internalError('Failed to track affiliate click');
  }
}
