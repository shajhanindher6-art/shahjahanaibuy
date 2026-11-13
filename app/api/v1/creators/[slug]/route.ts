/**
 * API v1 creator storefront endpoint (Section 6, Item 14).
 * GET /api/v1/creators/[slug] — one creator's public storefront:
 * display name, derived badge, their own bio (or null), and their
 * VERIFIED-approved community deals only. Unverified and pending
 * deals are excluded. No earnings or payout figures are ever
 * returned — revenue share is unconfigured until the owner sets it,
 * and this route displays nothing about it.
 *
 * A creator with no verified deals still resolves, with an empty
 * deals list ("No verified deals yet"). Unknown slugs return 404.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess, internalError, notFound } from '@/lib/api/responses';
import { logger } from '@/lib/config/logger';
import { logApiRequest, rateLimitResponse, getClientIp } from '@/lib/api/middleware';
import { getCreatorBySlug } from '@/lib/creator-storefront';

import { logApiError } from '@/lib/api/error-logging';
export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: { slug: string } }
) {
  logApiRequest(request, { endpoint: 'creators.slug', slug: params.slug });
  const limited = await rateLimitResponse(`creators.slug:${getClientIp(request)}`, 120);
  if (limited) return limited;

  try {
    const supabase = await createSupabaseServerClient();
    const creator = await getCreatorBySlug(supabase, params.slug);
    if (!creator) return notFound('Creator not found');
    return apiSuccess(creator, 200, { storefrontsEnabled: true });
  } catch (err) {
    logApiError(err, { request, route: 'creators', status: 500 });
    logger.error('[creators.slug] unexpected error', { error: err instanceof Error ? err.message : err });
    return internalError('Failed to fetch creator storefront');
  }
}
