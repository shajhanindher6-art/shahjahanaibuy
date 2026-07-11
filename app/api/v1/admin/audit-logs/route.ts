/**
 * API v1 admin audit logs endpoint.
 * GET /api/v1/admin/audit-logs — list admin audit logs (admin only).
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess, internalError } from '@/lib/api/responses';
import { logApiRequest, requireAuth } from '@/lib/api/middleware';
import { getAdminAuditLogs } from '@/services/admin';

export async function GET(request: NextRequest) {
  logApiRequest(request, { endpoint: 'admin.audit-logs' });

  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  try {
    const { searchParams } = request.nextUrl;
    const limit = Math.min(200, Math.max(1, Number(searchParams.get('limit') ?? 50)));

    const supabase = await createSupabaseServerClient();
    const logs = await getAdminAuditLogs(supabase, limit);

    return apiSuccess(logs, 200);
  } catch {
    return internalError('Failed to fetch audit logs');
  }
}
