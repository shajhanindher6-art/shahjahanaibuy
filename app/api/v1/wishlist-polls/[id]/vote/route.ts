/**
 * API v1 wishlist poll vote endpoint (Section 6, Item 13).
 * POST /api/v1/wishlist-polls/[id]/vote — { optionId }.
 *
 * Auth required. One vote per user per poll (UNIQUE (poll_id,
 * user_id) in migration 033): voting again moves the vote to the
 * new option, mirroring the community-deal vote route. Voting on a
 * closed poll is rejected. Returns the poll with updated real vote
 * counts. If the tables do not exist yet, returns 503 with an
 * honest message.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  apiSuccess,
  internalError,
  notFound,
  serviceUnavailable,
  validationError,
} from '@/lib/api/responses';
import { logApiRequest, requireAuth, rateLimitResponse, getClientIp } from '@/lib/api/middleware';
import { getPollResults } from '@/lib/wishlist-polls';

export const dynamic = 'force-dynamic';

function isMissingTable(error: { code?: string } | null | undefined): boolean {
  return error?.code === '42P01' || error?.code === 'PGRST205';
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  logApiRequest(request, { endpoint: 'wishlist-polls.vote', id: params.id });
  // Rate limit: 30 requests/min per IP (see docs/rate-limits.md).
  const limited = await rateLimitResponse(`wishlist-polls.id.vote:${getClientIp(request)}`, 30);
  if (limited) return limited;

  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  try {
    const body = await request.json().catch(() => null);
    const optionId = typeof body?.optionId === 'string' ? body.optionId.trim() : '';
    if (!optionId) return validationError('optionId is required.');

    const supabase = await createSupabaseServerClient();
    const { data: poll, error: pollError } = await supabase
      .from('wishlist_polls')
      .select('id, status')
      .eq('id', params.id)
      .maybeSingle();
    if (pollError) {
      if (isMissingTable(pollError)) {
        return serviceUnavailable(
          'Wishlist polls are not set up yet — the owner still needs to run migration 033 once.'
        );
      }
      return internalError('Failed to fetch poll');
    }
    if (!poll) return notFound('Poll not found');
    if ((poll as { status: string }).status !== 'open') {
      return validationError('This poll is closed.');
    }

    // The option must belong to this poll.
    const { data: option, error: optionError } = await supabase
      .from('wishlist_poll_options')
      .select('id')
      .eq('id', optionId)
      .eq('poll_id', params.id)
      .maybeSingle();
    if (optionError) return internalError('Failed to verify poll option');
    if (!option) return validationError('That option does not belong to this poll.');

    const { error } = await supabase.from('wishlist_poll_votes').upsert(
      { poll_id: params.id, option_id: optionId, user_id: auth.userId },
      { onConflict: 'poll_id,user_id' }
    );
    if (error) {
      if (isMissingTable(error)) {
        return serviceUnavailable(
          'Wishlist polls are not set up yet — the owner still needs to run migration 033 once.'
        );
      }
      return internalError('Failed to save vote');
    }

    const { poll: updated, pollsEnabled } = await getPollResults(supabase, params.id, auth.userId);
    if (!updated) return notFound('Poll not found');
    return apiSuccess(updated, 200, { pollsEnabled });
  } catch {
    return internalError('Failed to save vote');
  }
}
