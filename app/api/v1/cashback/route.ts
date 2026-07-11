/**
 * API v1 cashback endpoint.
 * GET /api/v1/cashback — list active cashback offers.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess, internalError } from '@/lib/api/responses';
import { logApiRequest } from '@/lib/api/middleware';
import { getCashbackOffers } from '@/services/commerce';

export async function GET(request: NextRequest) {
  logApiRequest(request, { endpoint: 'cashback' });

  try {
    const { searchParams } = request.nextUrl;
    const page = Math.max(1, Number(searchParams.get('page') ?? 1));
    const pageSize = Math.min(100, Math.max(1, Number(searchParams.get('pageSize') ?? 20)));
    const merchantId = searchParams.get('merchantId') ?? undefined;
    const productId = searchParams.get('productId') ?? undefined;
    const limit = pageSize;

    const supabase = await createSupabaseServerClient();
    const offers = await getCashbackOffers(supabase, {
      merchantId,
      productId,
      active: true,
      limit,
    });

    const total = offers.length;
    const offset = (page - 1) * pageSize;
    const paged = offers.slice(offset, offset + pageSize);
    const totalPages = Math.ceil(total / pageSize);

    return apiSuccess(paged, 200, { page, pageSize, total, totalPages });
  } catch {
    return internalError('Failed to fetch cashback offers');
  }
}
