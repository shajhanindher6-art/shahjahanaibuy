/**
 * API v1 admin background-job monitoring endpoint.
 * GET /api/v1/admin/monitoring/jobs — read-only background-job
 * status (Sections 21–25, Stage G; audit §4: background-job
 * monitoring was MISSING — no GET/list, in-memory last-100, no
 * BullMQ — because the BullMQ package is not installed and the
 * queue is synchronous in-process).
 *
 * Reads the in-memory queue state on THIS instance only:
 * metrics, the dead-letter queue, and the last-100 recorded job
 * outcomes (`lib/workers/queue.ts`). No new tables, nothing
 * enqueued, nothing retried. The response carries an honesty
 * note: in synchronous mode (no Redis — the live state) every
 * number below is this instance's state and is lost on
 * redeploy/restart; if a BullMQ worker ever ran (package not
 * installed today), no job outcome would be recorded here.
 *
 * ADMIN-ONLY (requireAdmin) + rate-limited. GET only, so no
 * CSRF check applies.
 */

import type { NextRequest } from 'next/server';
import { apiSuccess } from '@/lib/api/responses';
import { logApiRequest, requireAdmin, rateLimitResponse, getClientIp } from '@/lib/api/middleware';
import { getBackgroundJobStatus } from '@/services/admin-monitoring';

import { logApiError } from '@/lib/api/error-logging';
import { internalError } from '@/lib/api/responses';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  logApiRequest(request, { endpoint: 'admin.monitoring.jobs' });
  const limited = await rateLimitResponse(`admin.monitoring.jobs:${getClientIp(request)}`, 60);
  if (limited) return limited;

  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;

  try {
    return apiSuccess(getBackgroundJobStatus());
  } catch (err) {
    logApiError(err, { request, route: 'admin.monitoring.jobs', status: 500 });
    return internalError('Failed to fetch background job status');
  }
}
