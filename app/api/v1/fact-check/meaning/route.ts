/**
 * API v1 fact-check meaning endpoint (Section 5 #16).
 * GET /api/v1/fact-check/meaning — the PUBLIC meaning of "Verified"
 * for deals, plus the takedown policy. No database, no auth: this is
 * published text, so shoppers always know exactly what the badge
 * does — and does not — mean.
 */

import type { NextRequest } from 'next/server';
import { apiSuccess } from '@/lib/api/responses';
import { logApiRequest, rateLimitResponse, getClientIp } from '@/lib/api/middleware';
import { DEAL_VERIFIED_MEANING, DEAL_TAKEDOWN_POLICY } from '@/lib/fact-check';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  logApiRequest(request, { endpoint: 'fact-check.meaning' });

  const limited = await rateLimitResponse(`fact-check-meaning:${getClientIp(request)}`, 60);
  if (limited) return limited;

  return apiSuccess({
    meaning: DEAL_VERIFIED_MEANING,
    takedownPolicy: DEAL_TAKEDOWN_POLICY,
  });
}
