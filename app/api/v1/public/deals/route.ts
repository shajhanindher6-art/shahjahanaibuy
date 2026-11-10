/**
 * Public read-only API — deals (Section 4, item 18).
 * GET /api/v1/public/deals — active deals, soonest-ending first.
 *
 * Same auth/rate-limit tiers as the other public routes: optional
 * `x-api-key` (120/min) or anonymous (30/min). Daily quota
 * (Section 9): anonymous 100/day per IP, Free key 1,000/day,
 * Premium/Family 10,000/day, Team 100,000/day (see lib/api-quota.ts).
 * An invalid presented key is rejected (401). Only active,
 * non-deleted deals are returned; when there are none the list is
 * honestly empty.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess, internalError, unauthorized } from '@/lib/api/responses';
import { logApiRequest, rateLimitResponse, getClientIp } from '@/lib/api/middleware';
import { extractApiKey, validateApiKey } from '@/lib/api-keys';
import { enforceApiQuota } from '@/lib/api-quota';
import { getDeals } from '@/services/commerce';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  logApiRequest(request, { endpoint: 'public.deals' });

  const presentedKey = extractApiKey(request.headers);
  const keyInfo = presentedKey ? await validateApiKey(presentedKey) : null;
  if (presentedKey && !keyInfo) return unauthorized('Invalid API key');

  const limited = await rateLimitResponse(
    keyInfo ? `public-api:key:${keyInfo.keyPrefix}` : `public-api:ip:${getClientIp(request)}`,
    keyInfo ? 120 : 30
  );
  if (limited) return limited;

  // Section 9: daily per-key quota (tier-gated) / anonymous daily
  // cap. Key-optional access is unchanged for low-volume use.
  const quotaExceeded = await enforceApiQuota(request, { keyInfo });
  if (quotaExceeded) return quotaExceeded;

  try {
    const { searchParams } = request.nextUrl;
    const page = Math.max(1, Number(searchParams.get('page') ?? 1));
    const pageSize = Math.min(100, Math.max(1, Number(searchParams.get('pageSize') ?? 20)));
    const productId = searchParams.get('productId') ?? undefined;

    const supabase = await createSupabaseServerClient();
    const deals = await getDeals(supabase, {
      productId,
      active: true,
      limit: pageSize,
    });

    const total = deals.length;
    const offset = (page - 1) * pageSize;
    const paged = deals.slice(offset, offset + pageSize);

    return apiSuccess(paged, 200, {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    });
  } catch {
    return internalError('Failed to fetch deals');
  }
}
