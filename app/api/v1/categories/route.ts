/**
 * API v1 categories endpoint.
 * GET /api/v1/categories — return the active category tree.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess, internalError } from '@/lib/api/responses';
import { logApiRequest, rateLimitResponse, getClientIp } from '@/lib/api/middleware';
import { getCategoryTree } from '@/services/catalog';

import { logApiError } from '@/lib/api/error-logging';
export async function GET(request: NextRequest) {
  logApiRequest(request, { endpoint: 'categories' });
  // Rate limit: 120 requests/min per IP (see docs/rate-limits.md).
  const limited = await rateLimitResponse(`categories:${getClientIp(request)}`, 120);
  if (limited) return limited;

  try {
    const supabase = await createSupabaseServerClient();
    const tree = await getCategoryTree(supabase);

    return apiSuccess(tree);
  } catch (err) {
    logApiError(err, { request, route: 'categories', status: 500 });
    return internalError('Failed to fetch category tree');
  }
}
