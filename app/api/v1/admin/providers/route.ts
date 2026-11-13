/**
 * API v1 admin provider-health endpoint (Sections 21–25, Stage B, B13).
 * GET /api/v1/admin/providers — admin only (requireAdmin + lib/admin-role.ts, never a new guard).
 *
 * READ-ONLY: a single GET that reports provider health for the
 * /admin/ai control center. There is no POST/PUT/DELETE and no
 * provider-config write surface (owner-gated). The payload is
 * built by `getProviderHealthPanel` (services/provider-status.ts):
 * - providers: every registered provider — available or not, with
 *   the plain-language NOT_CONFIGURED reason (B2), the circuit
 *   breaker state (B3), and the daily budget usage (B12).
 * - health: provider_health rows (status, counts, last success /
 *   failure / error) — empty, honestly, while the table is
 *   unapplied.
 * - syncHistory: the last sync_history rows — empty, honestly,
 *   while nothing has written them.
 * - merchantReliability: the canonical merchant-reliability
 *   scorer (A10) over the merchants directory — a null score
 *   means "not enough data", never a guess.
 * - tablesMissing: tables that could not be read (unapplied
 *   migrations), by name — never a silent empty.
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
import { getProviderHealthPanel } from '@/services/provider-status';

import { logApiError } from '@/lib/api/error-logging';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  logApiRequest(request, { endpoint: 'admin.providers' });
  const limited = await rateLimitResponse(`admin.providers:${getClientIp(request)}`, 60);
  if (limited) return limited;

  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;

  try {
    const service = createSupabaseServiceClient();
    const panel = await getProviderHealthPanel(service);
    return apiSuccess(panel);
  } catch (err) {
    logApiError(err, { request, route: 'admin.providers', status: 500 });
    return internalError('Failed to fetch provider health');
  }
}
