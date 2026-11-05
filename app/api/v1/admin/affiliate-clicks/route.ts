/**
 * API v1 admin affiliate-clicks endpoint — Step C (Phase 4 Workstream C).
 * GET /api/v1/admin/affiliate-clicks?days=7|30|90 — geo-click
 * analytics for the admin dashboard (totals, breakdowns by country /
 * retailer / product / day, recent clicks, burst flags).
 *
 * ADMIN-ONLY, FAIL CLOSED: role === 'admin' is verified by the
 * shared requireAdmin helper (profiles row via the service-role
 * client) before reading anything. A missing profile or a non-admin
 * role gets 403.
 *
 * The read itself also uses the service-role client: the
 * affiliate_geo_clicks table has no anon read policy by design.
 * Query param `days` accepts 7, 30, or 90 (default 30). The response
 * carries every breakdown at once — no groupBy param is needed at
 * this volume; see services/affiliate-analytics.ts for the burst
 * rule (flagged buckets are excluded from headline totals).
 */

import type { NextRequest } from 'next/server';
import { apiSuccess, internalError } from '@/lib/api/responses';
import { logApiRequest, requireAdmin } from '@/lib/api/middleware';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { getAffiliateClickAnalytics } from '@/services/admin';

export async function GET(request: NextRequest) {
  logApiRequest(request, { endpoint: 'admin.affiliate-clicks' });

  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;

  const service = createSupabaseServiceClient();
  if (!service) {
    return internalError('Admin analytics unavailable (service key missing)');
  }

  const daysParam = request.nextUrl.searchParams.get('days');
  const days = daysParam === '7' || daysParam === '90' ? Number(daysParam) : 30;

  try {
    const analytics = await getAffiliateClickAnalytics(service, days);
    return apiSuccess(analytics, 200);
  } catch {
    return internalError('Failed to fetch affiliate click analytics');
  }
}
