/**
 * API v1 admin products endpoint (Section 20, §12 #69).
 * GET /api/v1/admin/products — admin only (requireAdmin +
 * lib/admin-role.ts, never a new guard).
 *
 * Lists ALL products — pending / rejected rows included, unlike
 * the public /api/v1/products — with search (q), status, and
 * price-verification filters. The page /admin/products reads this
 * endpoint. No write here; edits live on /[id].
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { apiSuccess, internalError } from '@/lib/api/responses';
import {
  logApiRequest,
  requireAdmin,
  rateLimitResponse,
  getClientIp,
} from '@/lib/api/middleware';
import { listAdminProducts } from '@/services/admin-products';
import { logApiError } from '@/lib/api/error-logging';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  logApiRequest(request, { endpoint: 'admin.products.list' });
  const limited = await rateLimitResponse(`admin-products-list:${getClientIp(request)}`, 60);
  if (limited) return limited;

  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;

  const service = createSupabaseServiceClient();
  if (!service) {
    return internalError('Admin products unavailable: service client not configured');
  }

  try {
    const params = request.nextUrl.searchParams;
    const result = await listAdminProducts(service, {
      search: params.get('q') ?? undefined,
      status: params.get('status') ?? undefined,
      verification: params.get('verification') ?? undefined,
      page: Number(params.get('page') ?? 1),
      pageSize: Number(params.get('pageSize') ?? 20),
    });
    return apiSuccess(result);
  } catch (err) {
    logApiError(err, { request, route: 'admin.products.list', status: 500 });
    return internalError('Failed to list products');
  }
}
