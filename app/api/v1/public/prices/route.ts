/**
 * Public read-only API — recorded prices (Section 4, item 18).
 * GET /api/v1/public/prices?product_id=<uuid> — recent recorded prices.
 * GET /api/v1/public/prices?slug=<product-slug> — same, resolved by slug.
 *
 * Returns rows from `price_history` (recorded data) only — never a
 * live retailer price. `product_id` or `slug` is required. Same
 * auth/rate-limit tiers as the other public routes: optional
 * `x-api-key` (120/min) or anonymous (30/min). Daily quota
 * (Section 9): anonymous 100/day per IP, Free key 1,000/day,
 * Premium/Family 10,000/day, Team 100,000/day (see lib/api-quota.ts).
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess, badRequest, internalError, notFound, unauthorized } from '@/lib/api/responses';
import { logApiRequest, rateLimitResponse, getClientIp } from '@/lib/api/middleware';
import { extractApiKey, validateApiKey } from '@/lib/api-keys';
import { enforceApiQuota } from '@/lib/api-quota';
import { getProductBySlug } from '@/services/products';

import { logApiError } from '@/lib/api/error-logging';
export const dynamic = 'force-dynamic';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest) {
  logApiRequest(request, { endpoint: 'public.prices' });

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
    const productIdParam = searchParams.get('product_id');
    const slugParam = searchParams.get('slug');
    const limit = Math.min(
      100,
      Math.max(1, Number(searchParams.get('limit') ?? 30))
    );

    let productId: string | null = null;
    if (productIdParam) {
      if (!UUID_RE.test(productIdParam)) return badRequest('product_id must be a UUID');
      productId = productIdParam;
    } else if (slugParam) {
      const supabase = await createSupabaseServerClient();
      const product = await getProductBySlug(supabase, slugParam);
      if (!product) return notFound('Product not found');
      productId = product.id;
    } else {
      return badRequest('product_id or slug is required');
    }

    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from('price_history')
      .select('price, recorded_at')
      .eq('product_id', productId)
      .order('recorded_at', { ascending: false })
      .limit(limit);

    if (error || !data) {
      return apiSuccess({
        productId,
        prices: [],
        source: 'recorded',
        dataNotice: 'No recorded prices yet for this product.',
      });
    }

    return apiSuccess({
      productId,
      prices: (data as Array<Record<string, unknown>>).map((r) => ({
        price: Number(r.price),
        recordedAt: r.recorded_at as string,
      })),
      source: 'recorded',
      dataNotice:
        'Recorded price history only — these are demo/seed prices, not live retailer prices.',
    });
  } catch (err) {
    logApiError(err, { request, route: 'public.prices', status: 500 });
    return internalError('Failed to fetch prices');
  }
}
