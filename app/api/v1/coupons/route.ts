/**
 * API v1 coupons endpoint.
 * GET /api/v1/coupons — list active coupons.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess, internalError } from '@/lib/api/responses';
import { logApiRequest, rateLimitResponse, getClientIp } from '@/lib/api/middleware';
import { getCoupons } from '@/services/commerce';

import { logApiError } from '@/lib/api/error-logging';
export async function GET(request: NextRequest) {
  logApiRequest(request, { endpoint: 'coupons' });
  // Rate limit: 120 requests/min per IP (see docs/rate-limits.md).
  const limited = await rateLimitResponse(`coupons:${getClientIp(request)}`, 120);
  if (limited) return limited;

  try {
    const { searchParams } = request.nextUrl;
    const page = Math.max(1, Number(searchParams.get('page') ?? 1));
    const pageSize = Math.min(100, Math.max(1, Number(searchParams.get('pageSize') ?? 20)));
    const merchantId = searchParams.get('merchantId') ?? undefined;
    const limit = pageSize;

    const supabase = await createSupabaseServerClient();
    const coupons = await getCoupons(supabase, {
      merchantId,
      active: true,
      limit,
    });

    const total = coupons.length;
    const offset = (page - 1) * pageSize;
    const paged = coupons.slice(offset, offset + pageSize);
    const totalPages = Math.ceil(total / pageSize);

    return apiSuccess(paged, 200, { page, pageSize, total, totalPages });
  } catch (err) {
    logApiError(err, { request, route: 'coupons', status: 500 });
    return internalError('Failed to fetch coupons');
  }
}
