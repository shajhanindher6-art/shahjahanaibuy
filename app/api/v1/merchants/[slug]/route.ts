/**
 * API v1 merchant detail endpoint.
 * GET /api/v1/merchants/[slug] — fetch a single merchant by slug.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess, notFound, internalError } from '@/lib/api/responses';
import { logApiRequest } from '@/lib/api/middleware';
import { getMerchantBySlug } from '@/services/commerce';

export async function GET(
  request: NextRequest,
  { params }: { params: { slug: string } }
) {
  logApiRequest(request, { endpoint: 'merchants.detail', slug: params.slug });

  try {
    const supabase = await createSupabaseServerClient();
    const merchant = await getMerchantBySlug(supabase, params.slug);

    if (!merchant) {
      return notFound('Merchant not found');
    }

    return apiSuccess(merchant);
  } catch {
    return internalError('Failed to fetch merchant');
  }
}
