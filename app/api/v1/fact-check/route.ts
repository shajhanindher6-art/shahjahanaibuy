/**
 * API v1 deal fact-check queue (Section 5 #16).
 * GET  /api/v1/fact-check — admin review queue (optional ?status=).
 * POST /api/v1/fact-check — create a check for a deal/subject (admin).
 *
 * POST runs the deterministic automated checks (lib/fact-check.ts)
 * over the numbers the admin supplies from real observations, then
 * stores the row as `pending` for human review. The code never
 * invents a price, a match, or a verdict — a check with no input
 * data is "inconclusive", never "passed".
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  apiSuccess,
  badRequest,
  conflict,
  internalError,
  serviceUnavailable,
} from '@/lib/api/responses';
import {
  logApiRequest,
  requireAdmin,
  rateLimitResponse,
  getClientIp,
} from '@/lib/api/middleware';
import {
  runAutomatedChecks,
  getFactCheckQueue,
  type FactCheckStatus,
} from '@/lib/fact-check';

import { logApiError } from '@/lib/api/error-logging';
export const dynamic = 'force-dynamic';

const VALID_STATUSES: FactCheckStatus[] = ['pending', 'approved', 'rejected', 'taken_down'];
const VALID_SUBJECT_TYPES = ['deal', 'community_deal', 'product', 'manual'] as const;

function toOptionalNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export async function GET(request: NextRequest) {
  logApiRequest(request, { endpoint: 'fact-check.queue' });

  const limited = await rateLimitResponse(`fact-check:${getClientIp(request)}`, 60);
  if (limited) return limited;

  const admin = await requireAdmin(request);
  if ('error' in admin) return admin.error;

  try {
    const statusParam = request.nextUrl.searchParams.get('status');
    const status: FactCheckStatus | undefined =
      statusParam && (VALID_STATUSES as string[]).includes(statusParam)
        ? (statusParam as FactCheckStatus)
        : undefined;

    const supabase = await createSupabaseServerClient();
    const queue = await getFactCheckQueue(supabase, status);

    return apiSuccess({
      queue,
      counts: {
        pending: queue.filter((q) => q.status === 'pending').length,
        total: queue.length,
      },
    });
  } catch (err) {
    logApiError(err, { request, route: 'fact-check.get', status: 500 });
    return internalError('Failed to fetch fact-check queue');
  }
}

export async function POST(request: NextRequest) {
  logApiRequest(request, { endpoint: 'fact-check.create' });

  const limited = await rateLimitResponse(`fact-check-create:${getClientIp(request)}`, 30);
  if (limited) return limited;

  const admin = await requireAdmin(request);
  if ('error' in admin) return admin.error;

  try {
    const body = await request.json().catch(() => null);

    const subjectType = body?.subjectType as string | undefined;
    const subjectId = body?.subjectId as string | undefined;
    const subjectTitle = body?.subjectTitle as string | undefined;

    if (!subjectType || !(VALID_SUBJECT_TYPES as readonly string[]).includes(subjectType)) {
      return badRequest('subjectType must be one of: deal, community_deal, product, manual');
    }
    if (typeof subjectId !== 'string' || subjectId.trim() === '') {
      return badRequest('subjectId is required');
    }
    if (typeof subjectTitle !== 'string' || subjectTitle.trim() === '') {
      return badRequest('subjectTitle is required');
    }

    const listingPrice = toOptionalNumber(body?.listingPrice);
    const compareAtPrice = toOptionalNumber(body?.compareAtPrice);
    const checkoutPrice = toOptionalNumber(body?.checkoutPrice);
    const historyLowest = toOptionalNumber(body?.historyLowest);
    const historyPoints =
      body?.historyPoints === null || body?.historyPoints === undefined
        ? null
        : Math.max(0, Math.floor(Number(body.historyPoints) || 0));
    const merchantCaution = body?.merchantCaution === true;

    if (listingPrice === null) {
      return badRequest('listingPrice (a positive number) is required to run the checks');
    }

    // Automated checks over admin-supplied real observations only.
    const { checks, overall } = runAutomatedChecks({
      listingPrice,
      compareAtPrice,
      checkoutPrice,
      historyLowest,
      historyPoints,
      merchantCaution,
    });

    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from('deal_fact_checks')
      .insert({
        subject_type: subjectType,
        subject_id: subjectId.trim(),
        subject_title: subjectTitle.trim().slice(0, 500),
        listing_price: listingPrice,
        compare_at_price: compareAtPrice,
        checkout_price: checkoutPrice,
        history_lowest: historyLowest,
        history_points: historyPoints,
        merchant_caution: merchantCaution,
        checks,
        overall,
        status: 'pending',
      })
      .select(
        'id, subject_type, subject_id, subject_title, listing_price, compare_at_price, checkout_price, history_lowest, history_points, merchant_caution, checks, overall, status, reviewer_id, reviewed_at, review_note, created_at, updated_at'
      )
      .single();

    if (error || !data) {
      if ((error as { code?: string } | null)?.code === '23505') {
        // The migration's partial unique index: this subject already
        // has a pending check.
        return conflict('This subject already has a pending fact-check.');
      }
      // Most likely the deal_fact_checks table does not exist yet
      // (migration 028 not run).
      return serviceUnavailable(
        'Fact-checking is not available yet — the fact-check queue has not been set up.'
      );
    }

    return apiSuccess(data, 201);
  } catch (err) {
    logApiError(err, { request, route: 'fact-check.post', status: 500 });
    return internalError('Failed to create fact-check');
  }
}
