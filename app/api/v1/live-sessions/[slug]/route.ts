/**
 * API v1 live shopping session detail endpoint.
 * GET /api/v1/live-sessions/[slug] — one session (status derived)
 *        plus its linked catalog products at their REAL current
 *        prices (lowest in-stock merchant listing, re-read at view
 *        time). Unknown slug → 404. Missing table (migration 033
 *        not run) → { session: null, products: [], liveEnabled: false }.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess, internalError, notFound } from '@/lib/api/responses';
import { logApiRequest, rateLimitResponse, getClientIp } from '@/lib/api/middleware';
import { getLiveSessionDetail } from '@/lib/live-sessions';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: { slug: string } }
) {
  logApiRequest(request, { endpoint: 'live-sessions.detail', slug: params.slug });
  // Rate limit: 120 requests/min per IP (see docs/rate-limits.md).
  const limited = await rateLimitResponse(`live-sessions:${getClientIp(request)}`, 120);
  if (limited) return limited;

  try {
    const supabase = await createSupabaseServerClient();
    const { session, products, liveEnabled } = await getLiveSessionDetail(supabase, params.slug);
    if (!liveEnabled) {
      return apiSuccess({ session: null, products: [] }, 200, { liveEnabled: false });
    }
    if (!session) {
      return notFound('Live shopping session not found');
    }
    return apiSuccess({ session, products }, 200, { liveEnabled: true });
  } catch (err) {
    console.error('[live-sessions] unexpected error', err);
    return internalError('Failed to fetch live shopping session');
  }
}
