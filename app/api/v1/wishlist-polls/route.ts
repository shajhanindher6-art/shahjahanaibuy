/**
 * API v1 wishlist polls (Section 6, Item 13).
 * GET  /api/v1/wishlist-polls?wishlistId=… — polls on a wishlist with
 *        real vote counts. The wishlist must be public or owned by
 *        the caller; private and missing lists both return 404, so a
 *        private list cannot be probed.
 * POST /api/v1/wishlist-polls — create a poll on a wishlist I own
 *        (auth required). Question 3–500 chars; every option must
 *        resolve to a real catalog product.
 *
 * Graceful degradation: if migration 033 has not been run yet, GET
 * returns { polls: [], pollsEnabled: false } and POST returns 503
 * with an honest message. No shared cart, no co-browsing.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  apiSuccess,
  badRequest,
  internalError,
  notFound,
  serviceUnavailable,
  validationError,
} from '@/lib/api/responses';
import { logger } from '@/lib/config/logger';
import { logApiRequest, requireAuth, rateLimitResponse, getClientIp } from '@/lib/api/middleware';
import {
  getPollsForWishlist,
  validatePollOptions,
  validatePollQuestion,
} from '@/lib/wishlist-polls';

export const dynamic = 'force-dynamic';

function isMissingTable(error: { code?: string } | null | undefined): boolean {
  return error?.code === '42P01' || error?.code === 'PGRST205';
}

export async function GET(request: NextRequest) {
  logApiRequest(request, { endpoint: 'wishlist-polls' });
  const limited = await rateLimitResponse(`wishlist-polls:${getClientIp(request)}`, 120);
  if (limited) return limited;

  const wishlistId = request.nextUrl.searchParams.get('wishlistId');
  if (!wishlistId) return badRequest('wishlistId is required');

  try {
    const supabase = await createSupabaseServerClient();
    // Visibility: public lists are readable by anyone; a private
    // list only by its owner. Missing and private lists are
    // indistinguishable (both 404) so existence cannot be probed.
    const { data: wishlist, error: wishlistError } = await supabase
      .from('wishlists')
      .select('id, user_id, is_public')
      .eq('id', wishlistId)
      .maybeSingle();
    if (wishlistError || !wishlist) return notFound('Wishlist not found');
    const w = wishlist as { id: string; user_id: string; is_public: boolean };
    if (!w.is_public) {
      const auth = await requireAuth(request);
      if ('error' in auth || auth.userId !== w.user_id) return notFound('Wishlist not found');
    }
    const auth = await requireAuth(request);
    const userId = 'error' in auth ? null : auth.userId;
    const { polls, pollsEnabled } = await getPollsForWishlist(supabase, wishlistId, userId);
    return apiSuccess(polls, 200, { pollsEnabled });
  } catch (err) {
    logger.error('[wishlist-polls] unexpected error', { error: err instanceof Error ? err.message : err });
    return internalError('Failed to fetch wishlist polls');
  }
}

export async function POST(request: NextRequest) {
  logApiRequest(request, { endpoint: 'wishlist-polls.create' });
  // Rate limit: 30 requests/min per IP (see docs/rate-limits.md).
  const limited = await rateLimitResponse(`wishlist-polls:${getClientIp(request)}`, 30);
  if (limited) return limited;

  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  try {
    const body = await request.json().catch(() => null);
    const wishlistId = typeof body?.wishlistId === 'string' ? body.wishlistId.trim() : '';
    const questionError = validatePollQuestion(body?.question);
    if (!wishlistId) return validationError('wishlistId is required.');
    if (questionError) return validationError(questionError);
    const options = validatePollOptions(body?.productIds);
    if ('error' in options) return validationError(options.error);

    const supabase = await createSupabaseServerClient();
    // Ownership: polls can only be created on a wishlist I own.
    const { data: wishlist, error: wishlistError } = await supabase
      .from('wishlists')
      .select('user_id')
      .eq('id', wishlistId)
      .maybeSingle();
    if (wishlistError || !wishlist) return notFound('Wishlist not found');
    if ((wishlist as { user_id: string }).user_id !== auth.userId) {
      return notFound('Wishlist not found');
    }

    // Every option must resolve to a real catalog product.
    const { data: products, error: productsError } = await supabase
      .from('products')
      .select('id')
      .in('id', options.productIds)
      .is('deleted_at', null);
    if (productsError) return internalError('Failed to verify poll options');
    const found = new Set(((products ?? []) as Array<{ id: string }>).map((p) => p.id));
    const unresolved = options.productIds.filter((id) => !found.has(id));
    if (unresolved.length > 0) {
      return validationError('Every poll option must be a real catalog product.');
    }

    const { data: poll, error: pollError } = await supabase
      .from('wishlist_polls')
      .insert({
        wishlist_id: wishlistId,
        question: (body.question as string).trim(),
        created_by: auth.userId,
        status: 'open',
      })
      .select('id, wishlist_id, question, status, created_by, created_at')
      .single();
    if (pollError || !poll) {
      if (isMissingTable(pollError)) {
        return serviceUnavailable(
          'Wishlist polls are not set up yet — the owner still needs to run migration 033 once.'
        );
      }
      return internalError('Failed to create poll');
    }

    const { error: optionsError } = await supabase.from('wishlist_poll_options').insert(
      options.productIds.map((productId) => ({
        poll_id: (poll as { id: string }).id,
        product_id: productId,
      }))
    );
    if (optionsError) {
      // The poll exists but its options failed: remove the orphan
      // poll rather than leaving a question with no choices.
      await supabase.from('wishlist_polls').delete().eq('id', (poll as { id: string }).id);
      if (isMissingTable(optionsError)) {
        return serviceUnavailable(
          'Wishlist polls are not set up yet — the owner still needs to run migration 033 once.'
        );
      }
      return internalError('Failed to create poll options');
    }

    return apiSuccess(
      {
        id: (poll as { id: string }).id,
        wishlistId,
        question: (body.question as string).trim(),
        status: 'open',
        options: options.productIds.map((productId) => ({ productId })),
        totalVotes: 0,
        userVotedOptionId: null,
      },
      201,
      { pollsEnabled: true }
    );
  } catch {
    return internalError('Failed to create poll');
  }
}
