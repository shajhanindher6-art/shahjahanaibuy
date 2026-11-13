/**
 * API v1 merchant detail endpoint.
 * GET /api/v1/merchants/[slug] — fetch a single merchant by slug.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess, notFound, internalError } from '@/lib/api/responses';
import { logApiRequest, rateLimitResponse, getClientIp } from '@/lib/api/middleware';
import { getMerchantBySlug } from '@/services/commerce';

import { logApiError } from '@/lib/api/error-logging';
export async function GET(
  request: NextRequest,
  { params }: { params: { slug: string } }
) {
  logApiRequest(request, { endpoint: 'merchants.detail', slug: params.slug });
  // Rate limit: 120 requests/min per IP (see docs/rate-limits.md).
  const limited = await rateLimitResponse(`merchants.slug:${getClientIp(request)}`, 120);
  if (limited) return limited;

  try {
    const supabase = await createSupabaseServerClient();
    const merchant = await getMerchantBySlug(supabase, params.slug);

    if (!merchant) {
      return notFound('Merchant not found');
    }

    return apiSuccess(merchant);
  } catch (err) {
    logApiError(err, { request, route: 'merchants', status: 500 });
    return internalError('Failed to fetch merchant');
  }
}
