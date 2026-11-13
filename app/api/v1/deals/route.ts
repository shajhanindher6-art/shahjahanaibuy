/**
 * API v1 deals endpoint.
 * GET /api/v1/deals — list active deals.
 * GET /api/v1/deals?status=upcoming — deals scheduled to start in
 * the future (start_at > now), soonest first. No deals are invented:
 * when nothing is scheduled the list is honestly empty.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess, internalError } from '@/lib/api/responses';
import { logApiRequest, rateLimitResponse, getClientIp } from '@/lib/api/middleware';
import { getDeals } from '@/services/commerce';

import { logApiError } from '@/lib/api/error-logging';
export async function GET(request: NextRequest) {
  logApiRequest(request, { endpoint: 'deals' });
  // Rate limit: 120 requests/min per IP (see docs/rate-limits.md).
  const limited = await rateLimitResponse(`deals:${getClientIp(request)}`, 120);
  if (limited) return limited;

  try {
    const { searchParams } = request.nextUrl;
    const page = Math.max(1, Number(searchParams.get('page') ?? 1));
    const pageSize = Math.min(100, Math.max(1, Number(searchParams.get('pageSize') ?? 20)));
    const productId = searchParams.get('productId') ?? undefined;
    const upcoming = searchParams.get('status') === 'upcoming';
    const limit = pageSize;

    const supabase = await createSupabaseServerClient();
    const deals = await getDeals(supabase, {
      productId,
      active: true,
      limit,
      upcoming,
    });

    const total = deals.length;
    const offset = (page - 1) * pageSize;
    const paged = deals.slice(offset, offset + pageSize);
    const totalPages = Math.ceil(total / pageSize);

    return apiSuccess(paged, 200, { page, pageSize, total, totalPages });
  } catch (err) {
    logApiError(err, { request, route: 'deals', status: 500 });
    return internalError('Failed to fetch deals');
  }
}
