/**
 * API v1 AI admin control-center endpoint (Section 19, Phase 7, §12 #71 + #73).
 * GET /api/v1/admin/ai — admin only (requireAdmin + lib/admin-role.ts, never a new guard).
 *
 * READ-ONLY v1: a single GET that reports state; there is no POST/PUT/DELETE
 * and no provider-config write surface (owner-gated). The payload is:
 * - providers: Phase 1 engine `validate()` — per-provider availability
 *   (live providers are 'available-unverified': key present, never probed).
 * - usage: Phase 1 `getAiUsageSummary()` — in-memory per-instance calls /
 *   latency / budgets. The `note` in the payload states the limitation.
 * - accuracy: the shared `getAiAccuracySummary()` (services/ai-accuracy) —
 *   the SAME computation /owner shows. Honest "no outcomes recorded yet"
 *   while migration 032 is unapplied.
 * - errors: `getAiErrorBreakdown()` from error_log — fail-safe when
 *   migration 048 is unapplied ("error logging not yet active").
 * - dataQuality: `getAdminDataQualitySummary()` (Section 20, §12
 *   #85) — verification distribution, price freshness, spec /
 *   image / GTIN / review coverage, and the average DATA-quality
 *   score for the catalog the AI reasons over. Fail-safe: a missing
 *   migration 045 or an unreadable table is reported in `notes`,
 *   never as a measured zero.
 *
 * The service-role client is required for the accuracy + error reads;
 * when it is unavailable those sections report unavailable instead of
 * failing the whole response.
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
import { getAiEngine } from '@/services/ai-engine/providers';
import { getAiUsageSummaryAsync } from '@/services/ai-engine/usage';
import { getAiAccuracySummary } from '@/services/ai-accuracy';
import { getAiErrorBreakdown } from '@/services/error-log-admin';
import { getAdminDataQualitySummary } from '@/services/admin-data-quality';

import { logApiError } from '@/lib/api/error-logging';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  logApiRequest(request, { endpoint: 'admin.ai' });
  const limited = await rateLimitResponse(`admin.ai:${getClientIp(request)}`, 60);
  if (limited) return limited;

  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;

  try {
    const service = createSupabaseServiceClient();
    const [accuracy, errors, dataQuality] = service
      ? await Promise.all([
          getAiAccuracySummary(service),
          getAiErrorBreakdown(service, 200, { adminUserId: auth.userId }),
          getAdminDataQualitySummary(service, { adminUserId: auth.userId }),
        ])
      : [
          null,
          null,
          null,
        ];

    return apiSuccess({
      providers: getAiEngine().validate(),
      usage: await getAiUsageSummaryAsync(),
      accuracy,
      errors,
      dataQuality,
      serviceUnavailable: service === null,
    });
  } catch (err) {
    logApiError(err, { request, route: 'admin.ai', status: 500 });
    return internalError('Failed to fetch AI admin data');
  }
}
