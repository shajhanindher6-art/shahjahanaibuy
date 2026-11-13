/**
 * API v1 account deletion — Section 14, Chunk 7.
 * DELETE /api/v1/account — permanently deletes the signed-in
 * user's account. Body must be exactly { confirmation: "DELETE" };
 * anything else is a 400 and deletes nothing. The route deletes
 * the user's rows from every user-owned table (see
 * lib/account-deletion.ts), then deletes the auth user with the
 * service-role client. Deletion is permanent and irreversible.
 *
 * Honest failure modes, never a fake success: without
 * SUPABASE_SERVICE_ROLE_KEY the route answers 503 and deletes
 * nothing (the auth user can only be deleted with the service
 * key); if the auth delete fails after the rows were deleted,
 * the response says exactly that instead of claiming success.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import {
  apiSuccess,
  internalError,
  serviceUnavailable,
  validationError,
} from '@/lib/api/responses';
import { logApiRequest, rateLimitResponse, requireAuth } from '@/lib/api/middleware';
import {
  USER_DATA_TABLES,
  isValidDeleteConfirmation,
} from '@/lib/account-deletion';

import { logApiError } from '@/lib/api/error-logging';
export const dynamic = 'force-dynamic';

export async function DELETE(request: NextRequest) {
  logApiRequest(request, { endpoint: 'account.delete' });

  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  // One deletion per hour per user — a destructive action must
  // never be hammerable, and a retry after a failure still works.
  const limited = await rateLimitResponse(`account-delete:${auth.userId}`, 1, 3_600_000);
  if (limited) return limited;

  const body = await request.json().catch(() => null);
  if (!isValidDeleteConfirmation(body?.confirmation)) {
    return validationError('To delete your account, type DELETE to confirm.');
  }

  const service = createSupabaseServiceClient();
  if (!service) {
    return serviceUnavailable(
      'Account deletion is not configured yet — the site owner still needs to set SUPABASE_SERVICE_ROLE_KEY. Nothing was deleted.'
    );
  }

  const userId = auth.userId;
  const deletedTables: string[] = [];
  const skippedTables: string[] = [];

  try {
    // Wishlist items carry no user_id — delete by the user's
    // wishlist ids before the wishlists themselves go.
    try {
      const { data: lists } = await service
        .from('wishlists')
        .select('id')
        .eq('user_id', userId);
      const ids = (lists ?? [])
        .map((r) => (r as Record<string, unknown>).id)
        .filter((id): id is string => typeof id === 'string');
      if (ids.length > 0) {
        const { error } = await service
          .from('wishlist_items')
          .delete()
          .in('wishlist_id', ids);
        if (!error) deletedTables.push('wishlist_items');
        else skippedTables.push('wishlist_items');
      }
    } catch {
      skippedTables.push('wishlist_items');
    }

    for (const table of USER_DATA_TABLES) {
      // profiles is keyed by id, not user_id — deleted explicitly below.
      if (table === 'profiles') continue;
      try {
        const { error } = await service.from(table).delete().eq('user_id', userId);
        if (!error) deletedTables.push(table);
        else skippedTables.push(table);
      } catch {
        skippedTables.push(table);
      }
    }

    // profiles.id IS the auth user id.
    try {
      const { error } = await service.from('profiles').delete().eq('id', userId);
      if (!error) deletedTables.push('profiles');
      else skippedTables.push('profiles');
    } catch {
      skippedTables.push('profiles');
    }

    // The auth user itself, last. Without this the user could
    // still sign in to an emptied account.
    const { error: authError } = await service.auth.admin.deleteUser(userId);
    if (authError) {
      return internalError(
        'Your data rows were deleted, but deleting the sign-in account itself failed. Please contact support to finish the deletion.'
      );
    }

    // The server session is gone with the user; the client signs
    // out locally after this response.
    return apiSuccess({
      deleted: true,
      deletedTables,
      skippedTables,
      note: 'Guest (browser-token) push rows and aggregate referral-click counts are not linked to your account and were not deleted.',
    });
  } catch (err) {
    logApiError(err, { request, route: 'account', status: 500 });
    return internalError('Account deletion failed. Nothing further was deleted after the failure.');
  }
}
