/**
 * API v1 retailers endpoint.
 * GET /api/v1/retailers — list active retailers.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess, internalError } from '@/lib/api/responses';
import { logApiRequest } from '@/lib/api/middleware';
import { getRetailers } from '@/services/retailers';

export async function GET(request: NextRequest) {
  logApiRequest(request, { endpoint: 'retailers' });

  try {
    const { searchParams } = request.nextUrl;
    const page = Math.max(1, Number(searchParams.get('page') ?? 1));
    const pageSize = Math.min(100, Math.max(1, Number(searchParams.get('pageSize') ?? 20)));

    const supabase = await createSupabaseServerClient();
    const retailers = await getRetailers(supabase);

    const total = retailers.length;
    const offset = (page - 1) * pageSize;
    const paged = retailers.slice(offset, offset + pageSize);
    const totalPages = Math.ceil(total / pageSize);

    return apiSuccess(paged, 200, { page, pageSize, total, totalPages });
  } catch {
    return internalError('Failed to fetch retailers');
  }
}
