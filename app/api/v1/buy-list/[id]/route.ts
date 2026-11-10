/**
 * API v1 buy-list item endpoint (Section 6, Item 1 — trimmed).
 * PATCH  /api/v1/buy-list/[id] — update quantity (auth, owner only).
 * DELETE /api/v1/buy-list/[id] — remove from the shortlist (auth, owner only).
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  apiSuccess,
  internalError,
  notFound,
  validationError,
} from '@/lib/api/responses';
import { logApiRequest, requireAuth, rateLimitResponse, getClientIp } from '@/lib/api/middleware';
import { normalizeQuantity, removeBuyListItem, updateBuyListQuantity } from '@/lib/buy-list';

export const dynamic = 'force-dynamic';

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  logApiRequest(request, { endpoint: 'buy-list.update', id: params.id });
  // Rate limit: 30 requests/min per IP (see docs/rate-limits.md).
  const limited = await rateLimitResponse(`buy-list.id:${getClientIp(request)}`, 30);
  if (limited) return limited;

  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  try {
    const body = await request.json().catch(() => null);
    const quantity = normalizeQuantity(body?.quantity);
    if (quantity === null) {
      return validationError('quantity must be a whole number between 1 and 99.');
    }
    const supabase = await createSupabaseServerClient();
    const updated = await updateBuyListQuantity(supabase, auth.userId, params.id, quantity);
    if (!updated) return notFound('Buy list item not found or not owned by user');
    return apiSuccess(updated);
  } catch {
    return internalError('Failed to update buy list item');
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  logApiRequest(request, { endpoint: 'buy-list.delete', id: params.id });
  // Rate limit: 30 requests/min per IP (see docs/rate-limits.md).
  const limited = await rateLimitResponse(`buy-list.id:${getClientIp(request)}`, 30);
  if (limited) return limited;

  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  try {
    const supabase = await createSupabaseServerClient();
    const deleted = await removeBuyListItem(supabase, auth.userId, params.id);
    if (!deleted) return notFound('Buy list item not found or not owned by user');
    return apiSuccess({ id: params.id, deleted: true });
  } catch {
    return internalError('Failed to remove buy list item');
  }
}
