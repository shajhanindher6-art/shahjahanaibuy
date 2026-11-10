/**
 * API v1 price-protection watch endpoint (Section 6, Item 7 — trimmed).
 * PATCH  /api/v1/price-protection/[id] — submit a claim (auth, owner
 *        only). The ONLY allowed status change is to
 *        'claim_submitted'. A claim is a user-submitted record for
 *        review — NO refund is promised and no refund amount is
 *        ever stated.
 * DELETE /api/v1/price-protection/[id] — remove a watch (auth, owner only).
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  apiSuccess,
  badRequest,
  internalError,
  notFound,
} from '@/lib/api/responses';
import { logApiRequest, requireAuth, rateLimitResponse, getClientIp } from '@/lib/api/middleware';
import {
  deletePriceProtectionWatch,
  isValidStatusTransition,
  submitProtectionClaim,
} from '@/lib/price-protection';

export const dynamic = 'force-dynamic';

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  logApiRequest(request, { endpoint: 'price-protection.update', id: params.id });
  // Rate limit: 30 requests/min per IP (see docs/rate-limits.md).
  const limited = await rateLimitResponse(`price-protection.id:${getClientIp(request)}`, 30);
  if (limited) return limited;

  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  try {
    const body = await request.json().catch(() => null);
    if (!isValidStatusTransition(body?.status)) {
      return badRequest(
        "Only 'claim_submitted' is accepted here — a claim is recorded for review, no refund is guaranteed."
      );
    }
    const supabase = await createSupabaseServerClient();
    const updated = await submitProtectionClaim(supabase, auth.userId, params.id);
    if (!updated) return notFound('Protection watch not found or not owned by user');
    return apiSuccess(updated);
  } catch {
    return internalError('Failed to submit protection claim');
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  logApiRequest(request, { endpoint: 'price-protection.delete', id: params.id });
  // Rate limit: 30 requests/min per IP (see docs/rate-limits.md).
  const limited = await rateLimitResponse(`price-protection.id:${getClientIp(request)}`, 30);
  if (limited) return limited;

  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  try {
    const supabase = await createSupabaseServerClient();
    const deleted = await deletePriceProtectionWatch(supabase, auth.userId, params.id);
    if (!deleted) return notFound('Protection watch not found or not owned by user');
    return apiSuccess({ id: params.id, deleted: true });
  } catch {
    return internalError('Failed to remove protection watch');
  }
}
