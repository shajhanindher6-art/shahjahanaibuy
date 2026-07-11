/**
 * API v1 admin users endpoint.
 * GET /api/v1/admin/users — paginated list of all users (admin only).
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess, internalError } from '@/lib/api/responses';
import { logApiRequest, requireAuth } from '@/lib/api/middleware';
import { getAllUsers } from '@/services/admin';

export async function GET(request: NextRequest) {
  logApiRequest(request, { endpoint: 'admin.users' });

  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  try {
    const { searchParams } = request.nextUrl;
    const page = Math.max(1, Number(searchParams.get('page') ?? 1));
    const pageSize = Math.min(100, Math.max(1, Number(searchParams.get('pageSize') ?? 20)));

    const supabase = await createSupabaseServerClient();
    const result = await getAllUsers(supabase, page, pageSize);

    return apiSuccess(result.users, 200, {
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
    });
  } catch {
    return internalError('Failed to fetch users');
  }
}
