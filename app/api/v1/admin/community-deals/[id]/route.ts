/**
 * Admin community-deal moderation (Section 14, chunk 9).
 * PATCH /api/v1/admin/community-deals/[id] — admin only.
 *
 * Actions (body.action) — all write only to the existing
 * community_deals table, no new columns, no new tables:
 * - 'verify':   set is_verified = true  (admin confirmation — one of
 *   the two verification paths in services/community-deals.ts; the
 *   other is the merchant-price match within 5%).
 * - 'unverify': set is_verified = false (remove the admin confirmation;
 *   the deal may still verify by price match).
 * - 'reject':   set status = 'rejected' (hides the deal from the public
 *   list, which only shows status='approved').
 * - 'approve':  set status = 'approved' (restores a rejected deal;
 *   submissions auto-approve today, so this is a restore, not a queue
 *   step — the page says so).
 *
 * Upvotes play no part: verification is never earned by votes, and
 * this route takes no vote input at all.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import {
  apiSuccess,
  badRequest,
  internalError,
  notFound,
  serviceUnavailable,
} from '@/lib/api/responses';
import { logApiRequest, requireAdmin, rateLimitResponse, getClientIp } from '@/lib/api/middleware';
import { recordAdminAction } from '@/services/admin';

import { logApiError } from '@/lib/api/error-logging';
export const dynamic = 'force-dynamic';

const DEAL_COLUMNS =
  'id, user_id, author_name, product_id, product_name, merchant_id, merchant_name, price, deal_text, coupon_code, source_url, status, is_verified, created_at';

function isMissingTable(error: { code?: string } | null | undefined): boolean {
  return error?.code === '42P01' || error?.code === 'PGRST205';
}

const ACTIONS = ['verify', 'unverify', 'reject', 'approve'] as const;
type ModerationAction = (typeof ACTIONS)[number];

function patchFor(action: ModerationAction): Record<string, boolean | string> {
  if (action === 'verify') return { is_verified: true };
  if (action === 'unverify') return { is_verified: false };
  if (action === 'reject') return { status: 'rejected' };
  return { status: 'approved' };
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  logApiRequest(request, { endpoint: 'admin.community-deals.moderate', id: params.id });

  const admin = await requireAdmin(request);
  if ('error' in admin) return admin.error;

  const limited = await rateLimitResponse(`admin-community-deals:${admin.userId}`, 60);
  if (limited) return limited;

  const service = createSupabaseServiceClient();
  if (!service) {
    return internalError('Community-deal moderation unavailable: service client not configured');
  }

  let body: Record<string, unknown> | null = null;
  try {
    body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  } catch {
    body = null;
  }
  const action = body?.action;
  if (typeof action !== 'string' || !(ACTIONS as readonly string[]).includes(action)) {
    return badRequest('action must be one of: verify, unverify, reject, approve');
  }

  try {
    const { data, error } = await service
      .from('community_deals')
      .update(patchFor(action as ModerationAction))
      .eq('id', params.id)
      .select(DEAL_COLUMNS)
      .single();
    if (error) {
      if (isMissingTable(error)) {
        return serviceUnavailable(
          'Community deals are not set up yet — the owner still needs to run supabase/add-community-deals.sql once.'
        );
      }
      return internalError('Failed to moderate community deal');
    }
    if (!data) return notFound('Community deal not found');
    // Section 18, item 14 — audit the mutation. recordAdminAction
    // never throws: a logging failure is recorded by the logger and
    // never fails the admin action itself.
    await recordAdminAction(service, admin.userId, 'community_deal_moderate', 'community_deal', params.id, { action, ...patchFor(action as ModerationAction) }, getClientIp(request));
    return apiSuccess(data);
  } catch (err) {
    logApiError(err, { request, route: 'admin.community-deals', status: 500 });
    return internalError('Failed to moderate community deal');
  }
}
