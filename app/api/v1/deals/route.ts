/**
 * API v1 deals endpoint.
 * GET /api/v1/deals — list active deals.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess, internalError } from '@/lib/api/responses';
import { logApiRequest } from '@/lib/api/middleware';
import { getDeals } from '@/services/commerce';

export async function GET(request: NextRequest) {
  logApiRequest(request, { endpoint: 'deals' });

  try {
    const { searchParams } = request.nextUrl;
    const page = Math.max(1, Number(searchParams.get('page') ?? 1));
    const pageSize = Math.min(100, Math.max(1, Number(searchParams.get('pageSize') ?? 20)));
    const productId = searchParams.get('productId') ?? undefined;
    const limit = pageSize;

    const supabase = await createSupabaseServerClient();
    const deals = await getDeals(supabase, {
      productId,
      active: true,
      limit,
    });

    const total = deals.length;
    const offset = (page - 1) * pageSize;
    const paged = deals.slice(offset, offset + pageSize);
    const totalPages = Math.ceil(total / pageSize);

    return apiSuccess(paged, 200, { page, pageSize, total, totalPages });
  } catch {
    return internalError('Failed to fetch deals');
  }
}
