/**
 * Public API key revocation (Section 4, item 18).
 * DELETE /api/v1/public/keys/[keyId] — revoke one of the caller's own keys.
 *
 * Signed-in only. Revocation is a soft revoke (revoked_at = now):
 * the key stops validating immediately, but the row stays for audit.
 * Only the key's owner can revoke it — the query is scoped to the
 * caller's user id, so another user's key id simply finds nothing.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { apiSuccess, internalError, notFound } from '@/lib/api/responses';
import { logApiRequest, rateLimitResponse, requireAuth } from '@/lib/api/middleware';

export const dynamic = 'force-dynamic';

export async function DELETE(
  request: NextRequest,
  { params }: { params: { keyId: string } }
) {
  logApiRequest(request, { endpoint: 'public.keys.revoke', keyId: params.keyId });

  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  const limited = await rateLimitResponse(`public-keys-revoke:${auth.userId}`, 10);
  if (limited) return limited;

  const service = createSupabaseServiceClient();
  if (!service) {
    return internalError('Key management unavailable: service client not configured');
  }

  try {
    const { data, error } = await service
      .from('api_keys')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', params.keyId)
      .eq('user_id', auth.userId)
      .is('revoked_at', null)
      .select('id, key_prefix, revoked_at')
      .single();

    if (error || !data) {
      return notFound('API key not found or already revoked');
    }

    return apiSuccess(data);
  } catch {
    return internalError('Failed to revoke API key');
  }
}
