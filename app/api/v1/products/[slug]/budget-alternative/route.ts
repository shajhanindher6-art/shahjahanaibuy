/**
 * API v1 budget-alternative endpoint (Enterprise #12).
 * GET /api/v1/products/[slug]/budget-alternative?budget=1000 — a
 * vector-matched (95%+ cosine similarity) alternative to the
 * product that is within the shopper's budget, or an honest empty
 * result with a reason. Public: product prices are public catalog
 * data. Never invents an alternative, a similarity, or a price.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { findBudgetAlternative } from '@/services/alternative-recommender';
import { logger } from '@/lib/config/logger';
import {
  apiSuccess,
  badRequest,
  internalError,
  notFound,
  serviceUnavailable,
} from '@/lib/api/responses';
import { logApiRequest, rateLimitResponse, getClientIp } from '@/lib/api/middleware';

import { logApiError } from '@/lib/api/error-logging';
import { EXCLUDED_SLUGS } from '@/lib/public-products';
// Live DB data must never be served from a stale edge cache.
export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: { slug: string } }
) {
  // Section 19, item 96: a throw used to yield an unlogged Next 500.
  // The whole handler is wrapped so failures return the generic
  // error envelope instead.
  try {
    logApiRequest(request, { endpoint: 'products.budget-alternative' });
    // Rate limit: 120 requests/min per IP (see docs/rate-limits.md).
    const limited = await rateLimitResponse(`products.slug.budget-alternative:${getClientIp(request)}`, 120);
    if (limited) return limited;

    const rawBudget = request.nextUrl.searchParams.get('budget');
    const budget = rawBudget === null ? NaN : Number(rawBudget);
    if (!Number.isFinite(budget) || budget <= 0) {
      return badRequest('Provide a positive budget in USD (?budget=1000).');
    }

    const service = createSupabaseServiceClient();
    if (!service) {
      return serviceUnavailable('Alternative search is not configured yet (database service client unavailable).');
    }

    const { data: product, error } = await service
      .from('products')
      .select('id')
      .eq('slug', params.slug)
      .neq('slug', EXCLUDED_SLUGS[0])
      .is('deleted_at', null)
      .maybeSingle();
    if (error) {
      logger.error('budget-alternative: product lookup failed', { error: error.message });
      return internalError('Alternative search failed');
    }
    if (!product) return notFound('Product not found');

    const result = await findBudgetAlternative(service, (product as { id: string }).id, budget);
    if (result.reason === 'error') {
      return serviceUnavailable(result.note ?? 'Alternative search failed.');
    }
    return apiSuccess(
      {
        alternative: result.alternative,
        reason: result.reason,
        sourceLowestPriceUsd: result.sourceLowestPriceUsd,
        budgetUsd: result.budgetUsd,
        note: result.note,
      },
      200,
      { minSimilarity: 0.95 }
    );
  } catch (err) {
    logApiError(err, { request, route: 'products.budget-alternative', status: 500 });
    logger.error('products.budget-alternative: unexpected error', {
      error: err instanceof Error ? err.message : 'unknown',
    });
    return internalError('Alternative search failed');
  }
}
