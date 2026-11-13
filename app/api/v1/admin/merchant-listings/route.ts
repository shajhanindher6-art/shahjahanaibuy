/**
 * API v1 admin merchant-listings endpoint (FINAL 100%, F-P1-21).
 *
 * GET  /api/v1/admin/merchant-listings — admin only. Honest
 * coverage: how many merchant_products rows are REAL listings
 * (a merchant SKU recorded + a non-search URL) vs search URLs.
 * Today the seeded catalog is 0/20 real — the payload says so,
 * never "matched".
 * POST /api/v1/admin/merchant-listings — admin only. Manual
 * listing match: an admin attaches a REAL listing URL + SKU to a
 * product + merchant slug, with review. The URL must pass
 * validateManualListingMatch (real-listing pattern, never a
 * search URL); the write is confidence 1.0 / matched_by
 * 'manual' (services/merchant-listing-match.ts) and is recorded
 * in the admin audit log. No auto-matching happens here — a
 * human vouches for the listing.
 *
 * Guard pattern copied from app/api/v1/admin/intake/route.ts:
 * rateLimitResponse + requireAdmin + checkCsrfOrigin.
 */

import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { apiSuccess, badRequest, internalError } from '@/lib/api/responses';
import {
  logApiRequest,
  requireAdmin,
  rateLimitResponse,
  getClientIp,
} from '@/lib/api/middleware';
import { checkCsrfOrigin } from '@/lib/api/csrf';
import { logApiError } from '@/lib/api/error-logging';
import {
  attachMerchantListing,
  getRealListingCoverage,
} from '@/services/merchant-listing-match';
import { recordAdminAction } from '@/services/admin';

export const dynamic = 'force-dynamic';

const attachSchema = z.object({
  productId: z.string().uuid('productId must be a UUID'),
  merchantSlug: z.string().trim().min(1, 'merchantSlug is required').max(100),
  listingUrl: z.string().url('listingUrl must be a valid URL'),
  merchantSku: z.string().trim().min(1, 'merchantSku is required').max(200),
  price: z.number().positive('price must be positive').optional(),
  currencyId: z.string().uuid('currencyId must be a UUID').optional(),
});

export async function GET(request: NextRequest) {
  logApiRequest(request, { endpoint: 'admin.merchant-listings' });
  const limited = await rateLimitResponse(`admin.merchant-listings:${getClientIp(request)}`, 60);
  if (limited) return limited;

  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;

  const service = createSupabaseServiceClient();
  if (!service) {
    return internalError('Merchant listings unavailable: service client not configured');
  }

  try {
    const coverage = await getRealListingCoverage(service);
    return apiSuccess(coverage);
  } catch (err) {
    logApiError(err, { request, route: 'admin.merchant-listings', status: 500 });
    return internalError('Failed to fetch merchant listing coverage');
  }
}

export async function POST(request: NextRequest) {
  logApiRequest(request, { endpoint: 'admin.merchant-listings.attach' });
  const limited = await rateLimitResponse(`admin.merchant-listings:${getClientIp(request)}`, 20);
  if (limited) return limited;

  const csrf = checkCsrfOrigin(request);
  if (csrf) return csrf;

  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest('Request body must be valid JSON');
  }
  const parsed = attachSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(parsed.error.issues.map((i) => i.message).join('; '));
  }

  try {
    const service = createSupabaseServiceClient();
    if (!service) {
      return internalError('Merchant listings unavailable: service client not configured');
    }
    const result = await attachMerchantListing(service, parsed.data);
    if (!result.ok) {
      return badRequest(result.errors.join('; ') || 'Could not attach the listing');
    }
    await recordAdminAction(
      service,
      auth.userId,
      'merchant-listing.attach',
      'merchant_products',
      result.merchantProductId ?? null,
      {
        productId: parsed.data.productId,
        merchantSlug: parsed.data.merchantSlug,
        listingUrl: parsed.data.listingUrl,
        merchantSku: parsed.data.merchantSku,
        // The attach writes confidence 1.0 / matched_by 'manual'
        // itself; confidenceNotStored is true only while the
        // confidence columns are unapplied.
        matchConfidence: 1,
        matchedBy: 'manual',
        confidenceNotStored: result.confidenceNotStored ?? false,
      },
      getClientIp(request)
    );
    return apiSuccess({
      attached: true,
      merchantProductId: result.merchantProductId,
      matchConfidence: 1,
      matchedBy: 'manual',
      confidenceNotStored: result.confidenceNotStored ?? false,
    });
  } catch (err) {
    logApiError(err, { request, route: 'admin.merchant-listings.attach', status: 500 });
    return internalError('Failed to attach the merchant listing');
  }
}
