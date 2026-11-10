/**
 * API v1 Receipt Vault item deletion (Option 8, Feature 3).
 * DELETE /api/v1/vault/[id] — delete the signed-in user's own vault item.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess, internalError, notFound } from '@/lib/api/responses';
import { logApiRequest, requireAuth, rateLimitResponse, getClientIp } from '@/lib/api/middleware';

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  logApiRequest(request, { endpoint: 'vault.delete', id: params.id });
  // Rate limit: 30 requests/min per IP (see docs/rate-limits.md).
  const limited = await rateLimitResponse(`vault.id:${getClientIp(request)}`, 30);
  if (limited) return limited;

  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from('vault_items')
      .delete()
      .eq('id', params.id)
      .eq('user_id', auth.userId)
      .select('id');
    if (error) return internalError('Failed to delete vault item');
    if (!data || data.length === 0) return notFound('Vault item not found');
    return apiSuccess({ deleted: true });
  } catch {
    return internalError('Failed to delete vault item');
  }
}
