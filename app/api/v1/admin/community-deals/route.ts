/**
 * Admin community-deals list (Section 14, chunk 9).
 * GET /api/v1/admin/community-deals — admin only.
 *
 * Lists EVERY community deal (any status, newest first) for
 * moderation — the public GET only ever shows status='approved'.
 * The table supports moderation honestly: status is CHECKed to
 * ('approved', 'pending', 'rejected') in supabase/add-community-deals.sql
 * and is_verified is the admin-confirmation flag. Note the flow today:
 * submissions auto-approve (POST sets status='approved'), so there is
 * no pending queue to clear — moderation here means verifying good
 * deals (admin confirmation, the path that previously had no UI at
 * all) and rejecting bad ones (which hides them from the public list).
 *
 * Graceful degradation: if the table does not exist yet, 503 with an
 * honest message — never a crash, never fake deals.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { apiSuccess, internalError, serviceUnavailable } from '@/lib/api/responses';
import { logApiRequest, requireAdmin, rateLimitResponse } from '@/lib/api/middleware';

export const dynamic = 'force-dynamic';

const DEAL_COLUMNS =
  'id, user_id, author_name, product_id, product_name, merchant_id, merchant_name, price, deal_text, coupon_code, source_url, status, is_verified, created_at';

function isMissingTable(error: { code?: string } | null | undefined): boolean {
  return error?.code === '42P01' || error?.code === 'PGRST205';
}

export async function GET(request: NextRequest) {
  logApiRequest(request, { endpoint: 'admin.community-deals.list' });

  const admin = await requireAdmin(request);
  if ('error' in admin) return admin.error;

  const limited = await rateLimitResponse(`admin-community-deals:${admin.userId}`, 60);
  if (limited) return limited;

  const service = createSupabaseServiceClient();
  if (!service) {
    return internalError('Community-deal moderation unavailable: service client not configured');
  }

  try {
    const { data, error } = await service
      .from('community_deals')
      .select(DEAL_COLUMNS)
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) {
      if (isMissingTable(error)) {
        return serviceUnavailable(
          'Community deals are not set up yet — the owner still needs to run supabase/add-community-deals.sql once.'
        );
      }
      return internalError('Failed to fetch community deals');
    }
    return apiSuccess(data ?? []);
  } catch {
    return internalError('Failed to fetch community deals');
  }
}
