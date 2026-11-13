/**
 * API v1 saved recommendations endpoint (Section 19, Phase 4, §12 #41).
 * GET /api/v1/recommendations/saved — the signed-in user's saved recommendations.
 * POST /api/v1/recommendations/saved { productId } — save a recommended product.
 * DELETE /api/v1/recommendations/saved?productId=... — unsave it.
 *
 * Storage is the user's own "Saved recommendations" wishlist
 * (services/recommendation-feedback.ts) — no new table, no new
 * migration. A saved recommendation is visible on the dashboard
 * recommendations page and in /dashboard/wishlists.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess, internalError, validationError } from '@/lib/api/responses';
import { logApiRequest, requireAuth, rateLimitResponse, getClientIp } from '@/lib/api/middleware';
import { logApiError } from '@/lib/api/error-logging';
import {
  listSavedRecommendations,
  saveRecommendation,
  unsaveRecommendation,
} from '@/services/recommendation-feedback';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  logApiRequest(request, { endpoint: 'recommendations.saved.list' });
  const limited = await rateLimitResponse(`recommendations.saved:${getClientIp(request)}`, 120);
  if (limited) return limited;

  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  try {
    const supabase = await createSupabaseServerClient();
    const saved = await listSavedRecommendations(supabase, auth.userId);
    return apiSuccess(saved, 200, { total: saved.length });
  } catch (err) {
    logApiError(err, { request, route: 'recommendations.saved.list', status: 500 });
    return internalError('Failed to list saved recommendations');
  }
}

export async function POST(request: NextRequest) {
  logApiRequest(request, { endpoint: 'recommendations.saved.save' });
  const limited = await rateLimitResponse(`recommendations.saved:${getClientIp(request)}`, 30);
  if (limited) return limited;

  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  try {
    const body = await request.json().catch(() => null);
    const productId = typeof body?.productId === 'string' ? body.productId.trim() : '';
    if (!productId) return validationError('productId is required.');

    const supabase = await createSupabaseServerClient();
    const result = await saveRecommendation(supabase, auth.userId, productId);
    if (!result) {
      return internalError(
        'Could not save this recommendation yet — the saved list is not set up. Nothing was saved.'
      );
    }
    return apiSuccess(result, 200);
  } catch (err) {
    logApiError(err, { request, route: 'recommendations.saved.save', status: 500 });
    return internalError('Failed to save recommendation');
  }
}

export async function DELETE(request: NextRequest) {
  logApiRequest(request, { endpoint: 'recommendations.saved.unsave' });
  const limited = await rateLimitResponse(`recommendations.saved:${getClientIp(request)}`, 30);
  if (limited) return limited;

  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  try {
    const productId = request.nextUrl.searchParams.get('productId')?.trim() ?? '';
    if (!productId) return validationError('productId is required.');

    const supabase = await createSupabaseServerClient();
    const removed = await unsaveRecommendation(supabase, auth.userId, productId);
    return apiSuccess({ removed }, 200);
  } catch (err) {
    logApiError(err, { request, route: 'recommendations.saved.unsave', status: 500 });
    return internalError('Failed to remove saved recommendation');
  }
}
