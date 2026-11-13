/**
 * API v1 admin audit logs endpoint.
 * GET /api/v1/admin/audit-logs — list admin audit logs (admin only).
 *
 * Sections 21–25, Stage G, G-P2-3 — the viewer no longer swallows
 * failure into `[]`: `getAdminAuditLogs` returns `{ logs, error,
 * tableMissing }`, and a read failure is answered 503 with the
 * real reason (missing table → the audit-log migration is
 * unapplied), never a silent empty list. Filters (all optional,
 * server-side): `action` (exact action string), `adminId` (exact
 * admin user id), `q` (substring search over action / target_type
 * / target_id). `limit` 1–200, default 50.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess, internalError, serviceUnavailable } from '@/lib/api/responses';
import { logApiRequest, requireAdmin, rateLimitResponse, getClientIp } from '@/lib/api/middleware';
import { getAdminAuditLogs } from '@/services/admin';

import { logApiError } from '@/lib/api/error-logging';
export async function GET(request: NextRequest) {
  logApiRequest(request, { endpoint: 'admin.audit-logs' });
  // Rate limit: 60 requests/min per IP (see docs/rate-limits.md).
  const limited = await rateLimitResponse(`admin.audit-logs:${getClientIp(request)}`, 60);
  if (limited) return limited;

  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;

  try {
    const { searchParams } = request.nextUrl;
    const limit = Math.min(200, Math.max(1, Number(searchParams.get('limit') ?? 50) || 50));
    const action = searchParams.get('action') ?? undefined;
    const adminId = searchParams.get('adminId') ?? undefined;
    const search = searchParams.get('q') ?? undefined;

    const supabase = await createSupabaseServerClient();
    const result = await getAdminAuditLogs(supabase, limit, {
      adminUserId: auth.userId,
      action,
      adminId,
      search,
    });

    if (result.error) {
      if (result.tableMissing) {
        return serviceUnavailable(result.error);
      }
      return internalError(result.error);
    }

    return apiSuccess(result.logs, 200);
  } catch (err) {
    logApiError(err, { request, route: 'admin.audit-logs', status: 500 });
    return internalError('Failed to fetch audit logs');
  }
}
