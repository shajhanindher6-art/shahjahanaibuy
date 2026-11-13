/**
 * API v1 buy-list endpoint (Section 6, Item 1 — trimmed).
 * GET  /api/v1/buy-list — the signed-in user's shortlist, with live
 *        prices re-read at view time (auth required).
 * POST /api/v1/buy-list — add a product (auth required). Adding a
 *        product already listed bumps its quantity (dedupe).
 *
 * This is a SHORTLIST, not a checkout: SmartBuy never charges the
 * user. The user checks out at the retailer via the Where-to-Buy
 * link. No price is ever stored — see lib/buy-list.ts.
 *
 * Graceful degradation: if migration 033 has not been run yet, GET
 * returns { items: [], buyListEnabled: false } and POST returns 503
 * with an honest message.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  apiSuccess,
  badRequest,
  internalError,
  serviceUnavailable,
  validationError,
} from '@/lib/api/responses';
import { logger } from '@/lib/config/logger';
import { logApiRequest, requireAuth, rateLimitResponse, getClientIp } from '@/lib/api/middleware';
import {
  addBuyListItem,
  getBuyList,
  isMissingTableError,
  normalizeQuantity,
} from '@/lib/buy-list';

import { logApiError } from '@/lib/api/error-logging';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  logApiRequest(request, { endpoint: 'buy-list' });
  // Rate limit: 30 requests/min per IP (see docs/rate-limits.md).
  const limited = await rateLimitResponse(`buy-list:${getClientIp(request)}`, 30);
  if (limited) return limited;

  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  try {
    const supabase = await createSupabaseServerClient();
    const { items, enabled, error } = await getBuyList(supabase, auth.userId);
    if (error) {
      logger.error('[buy-list] fetch error', { error: error instanceof Error ? error.message : error });
      return internalError('Failed to fetch buy list');
    }
    return apiSuccess(items, 200, { buyListEnabled: enabled });
  } catch (err) {
    logApiError(err, { request, route: 'buy-list.get', status: 500 });
    logger.error('[buy-list] unexpected error', { error: err instanceof Error ? err.message : err });
    return internalError('Failed to fetch buy list');
  }
}

export async function POST(request: NextRequest) {
  logApiRequest(request, { endpoint: 'buy-list.create' });
  // Rate limit: 30 requests/min per IP (see docs/rate-limits.md).
  const limited = await rateLimitResponse(`buy-list:${getClientIp(request)}`, 30);
  if (limited) return limited;

  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  try {
    const body = await request.json().catch(() => null);
    const productId = typeof body?.productId === 'string' ? body.productId.trim() : '';
    const merchantProductId =
      typeof body?.merchantProductId === 'string' ? body.merchantProductId.trim() || null : null;
    if (!productId) return badRequest('productId is required');
    const quantity =
      body?.quantity === undefined ? 1 : normalizeQuantity(body.quantity);
    if (quantity === null) {
      return validationError('quantity must be a whole number between 1 and 99.');
    }

    const supabase = await createSupabaseServerClient();
    const result = await addBuyListItem(supabase, auth.userId, {
      productId,
      merchantProductId,
      quantity,
    });
    if ('error' in result) {
      if (result.missingTable || isMissingTableError(result.error)) {
        return serviceUnavailable(
          'The buy list is not set up yet — the owner still needs to run migration 033 (supabase/migrations/20261110130000_033_section6_nextgen.sql) once.'
        );
      }
      logger.error('[buy-list] create error', { error: result.error instanceof Error ? result.error.message : result.error });
      return internalError('Failed to add buy list item');
    }
    return apiSuccess(result.item, result.deduped ? 200 : 201, { buyListEnabled: true });
  } catch (err) {
    logApiError(err, { request, route: 'buy-list.post', status: 500 });
    logger.error('[buy-list] unexpected error', { error: err instanceof Error ? err.message : err });
    return internalError('Failed to add buy list item');
  }
}
