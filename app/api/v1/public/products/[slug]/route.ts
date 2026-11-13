/**
 * Public read-only API — single product (Section 4, item 18).
 * GET /api/v1/public/products/[slug] — one product + latest recorded price.
 *
 * Same auth/rate-limit tiers as the products list: optional
 * `x-api-key` (120/min) or anonymous (30/min). An invalid presented
 * key is rejected (401).
 *
 * The `latestRecordedPrice` is the most recent row in `price_history`
 * with its `recorded_at` — recorded data, not a live retailer quote,
 * and null when nothing has been recorded yet.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess, internalError, notFound, unauthorized } from '@/lib/api/responses';
import { logApiRequest, rateLimitResponse, getClientIp } from '@/lib/api/middleware';
import { extractApiKey, validateApiKey } from '@/lib/api-keys';
import { enforceApiQuota } from '@/lib/api-quota';
import { getProductBySlug } from '@/services/products';

import { logApiError } from '@/lib/api/error-logging';
export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: { slug: string } }
) {
  logApiRequest(request, { endpoint: 'public.products.slug', slug: params.slug });

  const presentedKey = extractApiKey(request.headers);
  const keyInfo = presentedKey ? await validateApiKey(presentedKey) : null;
  if (presentedKey && !keyInfo) return unauthorized('Invalid API key');

  const limited = await rateLimitResponse(
    keyInfo ? `public-api:key:${keyInfo.keyPrefix}` : `public-api:ip:${getClientIp(request)}`,
    keyInfo ? 120 : 30
  );
  if (limited) return limited;

  // Section 17, Stage D (§4 #4): daily per-key quota (tier-gated) /
  // anonymous daily cap — same pattern as public/products, prices
  // and deals. The detail endpoint previously validated the key
  // but never counted it, so a valid key could hammer it
  // without quota counting.
  const quotaExceeded = await enforceApiQuota(request, { keyInfo });
  if (quotaExceeded) return quotaExceeded;

  try {
    const supabase = await createSupabaseServerClient();
    const product = await getProductBySlug(supabase, params.slug);
    if (!product) return notFound('Product not found');

    const { data: latest } = await supabase
      .from('price_history')
      .select('price, recorded_at')
      .eq('product_id', product.id)
      .order('recorded_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const latestRow = latest as { price: unknown; recorded_at: string } | null;

    return apiSuccess({
      ...product,
      latestRecordedPrice:
        latestRow === null
          ? null
          : { price: Number(latestRow.price), recordedAt: latestRow.recorded_at },
      dataNotice:
        'Latest price is the most recent recorded price, not a live retailer quote.',
    });
  } catch (err) {
    logApiError(err, { request, route: 'public.products', status: 500 });
    return internalError('Failed to fetch product');
  }
}
