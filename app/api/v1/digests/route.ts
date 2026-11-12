/**
 * API v1 past weekly digests endpoint.
 * GET /api/v1/digests — past weekly digests for the signed-in user, newest week first.
 *
 * Section 15, B12: digests were write-only until now
 * (generateWeeklyDigest inserts into `weekly_digests` and nothing
 * ever read them back). This is the read side — no migration
 * needed: migration 009 already grants SELECT TO authenticated
 * USING auth.uid() = user_id (`select_own_digests`), and the
 * query is additionally scoped with .eq('user_id', auth.userId),
 * so a user can only ever see their own digests. ?limit= clamps
 * to 1–100 (default 20). An empty list is the honest answer when
 * no digest was ever generated for the user — including when
 * migration 009 is unapplied (nothing could have written a row
 * then either). The dashboard archive UI is a later worker's
 * (C2 saved searches owns app/dashboard/page.tsx); this endpoint
 * is what it will read from.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess, internalError } from '@/lib/api/responses';
import { logApiRequest, requireAuth, rateLimitResponse, getClientIp } from '@/lib/api/middleware';
import { getPastDigests } from '@/services/notifications';

// Section 15, B12 — live per-request data: never statically prerendered.
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  logApiRequest(request, { endpoint: 'digests' });
  // Rate limit: 120 requests/min per IP (same as GET /api/v1/notifications).
  const limited = await rateLimitResponse(`digests:${getClientIp(request)}`, 120);
  if (limited) return limited;

  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  const rawLimit = request.nextUrl.searchParams.get('limit');
  const parsedLimit = rawLimit === null ? 20 : Number.parseInt(rawLimit, 10);
  const limit = Number.isFinite(parsedLimit)
    ? Math.min(100, Math.max(1, parsedLimit))
    : 20;

  try {
    const supabase = await createSupabaseServerClient();
    const digests = await getPastDigests(supabase, auth.userId, limit);
    return apiSuccess(digests, 200, { total: digests.length, limit });
  } catch {
    return internalError('Failed to fetch digests');
  }
}
