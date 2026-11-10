/**
 * Public read-only API — products (Section 4, item 18).
 * GET /api/v1/public/products — list products (paginated, filtered).
 *
 * No sign-in required. An `x-api-key` header (see /api-docs) raises
 * the rate limit from 30/min to 120/min; without a key the anonymous
 * tier applies. A presented key that does not validate is rejected
 * (401) — fail closed, never silently treated as anonymous.
 *
 * Data notice: catalog prices in this project are demo/seed data,
 * not live retailer prices. This endpoint returns catalog fields
 * only; see /api/v1/public/prices for recorded price history.
 * Daily quota (Section 9): anonymous 100/day per IP, Free key
 * 1,000/day, Premium/Family 10,000/day, Team 100,000/day —
 * 429 with an upgrade pointer when exceeded (see lib/api-quota.ts).
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess, internalError, unauthorized } from '@/lib/api/responses';
import { logApiRequest, rateLimitResponse, getClientIp } from '@/lib/api/middleware';
import { extractApiKey, validateApiKey } from '@/lib/api-keys';
import { enforceApiQuota } from '@/lib/api-quota';
import { getProducts, type ProductListOptions } from '@/services/products';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  logApiRequest(request, { endpoint: 'public.products' });

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
    const search = searchParams.get('search') ?? undefined;
    const category = searchParams.get('category') ?? undefined;
    const brand = searchParams.get('brand') ?? undefined;

    const supabase = await createSupabaseServerClient();
    const options: ProductListOptions = { page, pageSize, search, category, brand };
    const result = await getProducts(supabase, options);

    return apiSuccess(result.products, 200, {
      page: result.page,
      pageSize: result.pageSize,
      total: result.total,
      totalPages: result.totalPages,
      dataNotice:
        'Catalog data only. Prices shown on SmartBuy AI are demo/seed data, not live retailer prices.',
    });
  } catch {
    return internalError('Failed to fetch products');
  }
}
