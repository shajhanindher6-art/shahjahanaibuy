/**
 * API v1 admin alert-delivery monitoring endpoint.
 * GET /api/v1/admin/monitoring/alert-delivery — read-only alert
 * delivery status (Sections 21–25, Stage G; audit §4: alert
 * delivery monitoring was MISSING).
 *
 * Reads the existing delivery records — `notification_queue`
 * (signed-in), `guest_notification_queue` (guest email, 026),
 * `digest_failures` (050) — newest first. No new tables, nothing
 * inserted, nothing sent. A missing table is reported honestly
 * (`tableMissing: true` + `error`) instead of an empty list.
 *
 * Query params: `limit` (1–100, default 50), `status`
 * (pending|sent|failed), `channel` (signed-in queue only).
 *
 * ADMIN-ONLY (requireAdmin) + rate-limited. GET only, so no
 * CSRF check applies.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { apiSuccess, internalError } from '@/lib/api/responses';
import { logApiRequest, requireAdmin, rateLimitResponse, getClientIp } from '@/lib/api/middleware';
import {
  listAlertDeliveries,
  listDigestFailures,
  listGuestAlertDeliveries,
} from '@/services/admin-monitoring';

import { logApiError } from '@/lib/api/error-logging';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  logApiRequest(request, { endpoint: 'admin.monitoring.alert-delivery' });
  const limited = await rateLimitResponse(`admin.monitoring.alert-delivery:${getClientIp(request)}`, 60);
  if (limited) return limited;

  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;

  const service = createSupabaseServiceClient();
  if (!service) {
    return internalError('Monitoring unavailable: service client not configured');
  }

  try {
    const { searchParams } = request.nextUrl;
    const limit = Math.min(100, Math.max(1, Number(searchParams.get('limit') ?? 50) || 50));
    const status = searchParams.get('status') ?? undefined;
    const channel = searchParams.get('channel') ?? undefined;

    const [signedIn, guest, digest] = await Promise.all([
      listAlertDeliveries(service, { adminUserId: auth.userId, limit, status, channel }),
      listGuestAlertDeliveries(service, { adminUserId: auth.userId, limit, status }),
      listDigestFailures(service, { adminUserId: auth.userId, limit }),
    ]);

    return apiSuccess({
      signedIn,
      guest,
      digestFailures: digest,
    });
  } catch (err) {
    logApiError(err, { request, route: 'admin.monitoring.alert-delivery', status: 500 });
    return internalError('Failed to fetch alert delivery status');
  }
}
