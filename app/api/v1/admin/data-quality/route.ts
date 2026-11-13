/**
 * API v1 admin data-quality endpoint (Section 20, §12 #85).
 * GET /api/v1/admin/data-quality — admin only (requireAdmin +
 * lib/admin-role.ts, never a new guard).
 *
 * Read-only summary for the /admin/ai data-quality panel:
 * verification distribution, price freshness, spec / image / GTIN
 * / review coverage, and the average data-quality score. The
 * payload is fail-safe — a missing migration 045 or an unreadable
 * table is reported in `notes`, never as a measured zero.
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
import { getAdminDataQualitySummary } from '@/services/admin-data-quality';
import { logApiError } from '@/lib/api/error-logging';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  logApiRequest(request, { endpoint: 'admin.data-quality' });
  const limited = await rateLimitResponse(`admin-data-quality:${getClientIp(request)}`, 60);
  if (limited) return limited;

  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;

  const service = createSupabaseServiceClient();
  if (!service) {
    return internalError('Data quality unavailable: service client not configured');
  }

  try {
    const summary = await getAdminDataQualitySummary(service);
    return apiSuccess(summary);
  } catch (err) {
    logApiError(err, { request, route: 'admin.data-quality', status: 500 });
    return internalError('Failed to compute data quality');
  }
}
