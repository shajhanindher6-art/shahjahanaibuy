/**
 * API v1 single fact-check entry (Section 5 #16).
 * GET   /api/v1/fact-check/[id] — one queue entry (admin).
 * PATCH /api/v1/fact-check/[id] — human review decision (admin):
 *         approve | reject | take down, with a note.
 *
 * A takedown also deactivates the underlying deal itself (for
 * subject_type "deal") via the service-role client, so a bad deal
 * leaves the listings the same day. The response reports
 * `takedownApplied` so the admin knows whether the deactivation
 * actually happened — a failed deactivation is reported, never hidden.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import {
  apiSuccess,
  badRequest,
  internalError,
  notFound,
} from '@/lib/api/responses';
import {
  logApiRequest,
  requireAdmin,
  rateLimitResponse,
  getClientIp,
} from '@/lib/api/middleware';
import { getFactCheck, type FactCheckStatus } from '@/lib/fact-check';
import { logger } from '@/lib/config/logger';
import { checkCsrfOrigin } from '@/lib/api/csrf';
import { recordAdminAction } from '@/services/admin';

import { logApiError } from '@/lib/api/error-logging';
export const dynamic = 'force-dynamic';

const DECISIONS: Record<string, FactCheckStatus> = {
  approve: 'approved',
  reject: 'rejected',
  take_down: 'taken_down',
  takedown: 'taken_down',
};

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  logApiRequest(request, { endpoint: 'fact-check.detail', id: params.id });

  const limited = await rateLimitResponse(`fact-check:${getClientIp(request)}`, 60);
  if (limited) return limited;

  const admin = await requireAdmin(request);
  if ('error' in admin) return admin.error;

  try {
    const supabase = await createSupabaseServerClient();
    const entry = await getFactCheck(supabase, params.id);
    if (!entry) {
      return notFound('Fact-check entry not found');
    }
    return apiSuccess(entry);
  } catch (err) {
    logApiError(err, { request, route: 'fact-check.get', status: 500 });
    return internalError('Failed to fetch fact-check entry');
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  logApiRequest(request, { endpoint: 'fact-check.decide', id: params.id });

  const limited = await rateLimitResponse(`fact-check-decide:${getClientIp(request)}`, 30);
  if (limited) return limited;

  // Sections 21–25, Stage G, G-P1-3 — CSRF Origin check
  // (cookie-authed mutation; absent Origin fails open for
  // non-browser clients). The middleware layer checks this too.
  const csrf = checkCsrfOrigin(request);
  if (csrf) return csrf;

  const admin = await requireAdmin(request);
  if ('error' in admin) return admin.error;

  try {
    const body = await request.json().catch(() => null);
    const decision = DECISIONS[body?.decision as string];
    const note = typeof body?.note === 'string' ? body.note.slice(0, 1000) : null;

    if (!decision) {
      return badRequest('decision must be one of: approve, reject, take_down');
    }

    const supabase = await createSupabaseServerClient();
    const entry = await getFactCheck(supabase, params.id);
    if (!entry) {
      return notFound('Fact-check entry not found');
    }
    if (entry.status !== 'pending') {
      return badRequest(`This entry was already decided (${entry.status}).`);
    }

    const { data, error } = await supabase
      .from('deal_fact_checks')
      .update({
        status: decision,
        reviewer_id: admin.userId,
        reviewed_at: new Date().toISOString(),
        review_note: note,
        updated_at: new Date().toISOString(),
      })
      .eq('id', params.id)
      .eq('status', 'pending')
      .select(
        'id, subject_type, subject_id, subject_title, listing_price, compare_at_price, checkout_price, history_lowest, history_points, merchant_caution, checks, overall, status, reviewer_id, reviewed_at, review_note, created_at, updated_at'
      )
      .single();

    if (error || !data) {
      return internalError('Failed to record the decision');
    }

    // Fast takedown: deactivate the deal itself so it leaves the
    // listings the same day. Only for subject_type "deal".
    let takedownApplied = false;
    if (decision === 'taken_down' && entry.subjectType === 'deal') {
      const service = createSupabaseServiceClient();
      if (service) {
        const { error: dealError } = await service
          .from('deals')
          .update({ active: false })
          .eq('id', entry.subjectId);
        if (dealError) {
          logger.warn('fact-check takedown: deal deactivation failed', {
            error: dealError.message,
            dealId: entry.subjectId,
          });
        } else {
          takedownApplied = true;
        }
      } else {
        logger.warn('fact-check takedown: service client unavailable, deal NOT deactivated', {
          dealId: entry.subjectId,
        });
      }
    }

    // Sections 21–25, Stage G, G-P1-2 — audit the decision.
    // recordAdminAction never throws: a logging failure is
    // recorded by the logger and never fails the response itself.
    const auditService = createSupabaseServiceClient();
    if (auditService) {
      await recordAdminAction(
        auditService,
        admin.userId,
        'fact_check_decide',
        'fact_check',
        params.id,
        { decision, takedownApplied },
        getClientIp(request)
      );
    }

    return apiSuccess({ ...data, takedownApplied });
  } catch (err) {
    logApiError(err, { request, route: 'fact-check.patch', status: 500 });
    return internalError('Failed to record the decision');
  }
}
