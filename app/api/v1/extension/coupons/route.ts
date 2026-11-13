/**
 * API v1 extension coupons endpoint.
 * GET /api/v1/extension/coupons?domain=amazon.com
 *
 * Public, no-auth endpoint for the SmartBuy browser extension: given
 * a retailer domain, return that merchant's currently-valid coupons.
 * It reuses services/commerce.getCoupons, which already filters the
 * active listing to currently-usable coupons (active flag + validity
 * window + usage limit) — an expired coupon is never served here.
 * Responses are capped (max 20) and contain only public coupon
 * fields — never service-role data or user-private data.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess, badRequest, internalError } from '@/lib/api/responses';
import { logApiRequest, rateLimitResponse, getClientIp } from '@/lib/api/middleware';
import { getCoupons, getMerchants } from '@/services/commerce';

import { logApiError } from '@/lib/api/error-logging';
/** Retailer domain fragment → merchant name in the merchants table. */
const DOMAIN_MERCHANTS: Array<{ fragment: string; name: string }> = [
  { fragment: 'amazon', name: 'Amazon' },
  { fragment: 'bestbuy', name: 'Best Buy' },
  { fragment: 'walmart', name: 'Walmart' },
  { fragment: 'ebay', name: 'eBay' },
  { fragment: 'aliexpress', name: 'AliExpress' },
];

export async function GET(request: NextRequest) {
  logApiRequest(request, { endpoint: 'extension/coupons' });
  // Rate limit: 120 requests/min per IP (see docs/rate-limits.md).
  const limited = await rateLimitResponse(`extension.coupons:${getClientIp(request)}`, 120);
  if (limited) return limited;

  try {
    const domain = (request.nextUrl.searchParams.get('domain') ?? '').toLowerCase();
    if (!domain) return badRequest('domain is required');
    const match = DOMAIN_MERCHANTS.find((m) => domain.includes(m.fragment));
    if (!match) return apiSuccess([], 200, { merchant: null, note: 'No SmartBuy merchant matches this domain.' });

    const supabase = await createSupabaseServerClient();
    const merchants = await getMerchants(supabase);
    const merchant = merchants.find((m) => m.name.toLowerCase() === match.name.toLowerCase());
    if (!merchant) return apiSuccess([], 200, { merchant: match.name, note: 'Merchant not found in catalog.' });

    const coupons = await getCoupons(supabase, { merchantId: merchant.id, active: true, limit: 20 });
    return apiSuccess(
      coupons.slice(0, 20).map((c) => ({
        code: c.code,
        description: c.description,
        discountType: c.discountType,
        discountValue: c.discountValue,
        validUntil: c.validUntil,
      })),
      200,
      { merchant: merchant.name, merchantId: merchant.id }
    );
  } catch (err) {
    logApiError(err, { request, route: 'extension.coupons', status: 500 });
    return internalError('Failed to fetch extension coupons');
  }
}
