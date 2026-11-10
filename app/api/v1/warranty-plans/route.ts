/**
 * API v1 warranty plans endpoint (Section 6, item 12).
 * GET  /api/v1/warranty-plans — public list of admin-recorded
 *        plans, optionally filtered by recorded category, sorted by
 *        recorded price_usd ascending with unpriced plans last.
 * POST /api/v1/warranty-plans — admin-only create.
 *
 * Graceful degradation: if migration 033 has not been run yet, the
 * table does not exist — GET returns { plans: [], warrantyEnabled:
 * false } (never a crash, never fake plans) and POST returns 503
 * with an honest message. No plan is ever recommended; only
 * recorded fields are returned.
 */

export const dynamic = 'force-dynamic';

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  apiSuccess,
  badRequest,
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
  getWarrantyPlansByCategory,
  createWarrantyPlan,
  isMissingTable,
  validateWarrantyPlanInput,
  type WarrantyPlanInput,
} from '@/lib/warranty-plans';

export async function GET(request: NextRequest) {
  logApiRequest(request, { endpoint: 'warranty-plans' });
  // Rate limit: 120 requests/min per IP (see docs/rate-limits.md).
  const limited = await rateLimitResponse(`warranty-plans:${getClientIp(request)}`, 120);
  if (limited) return limited;

  try {
    const category = request.nextUrl.searchParams.get('category');
    const supabase = await createSupabaseServerClient();
    // Probe for the table: a missing-table error means migration
    // 033 has not been run yet — report it honestly instead of
    // returning an empty list that looks like "no plans exist".
    const { error: probeError } = await supabase
      .from('warranty_plans')
      .select('id')
      .limit(1);
    if (probeError && isMissingTable(probeError)) {
      return apiSuccess([], 200, { warrantyEnabled: false });
    }
    if (probeError) {
      return internalError('Failed to fetch warranty plans');
    }
    const plans = await getWarrantyPlansByCategory(supabase, category);
    return apiSuccess(plans, 200, { warrantyEnabled: true });
  } catch (err) {
    console.error('[warranty-plans] unexpected error', err);
    return internalError('Failed to fetch warranty plans');
  }
}

export async function POST(request: NextRequest) {
  logApiRequest(request, { endpoint: 'warranty-plans' });
  // Rate limit: 30 requests/min per IP (see docs/rate-limits.md).
  const limited = await rateLimitResponse(`warranty-plans:${getClientIp(request)}`, 30);
  if (limited) return limited;

  try {
    const admin = await requireAdmin(request);
    if ('error' in admin) return admin.error;

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== 'object') {
      return badRequest('A JSON body with providerName and planName is required.');
    }

    const input: WarrantyPlanInput = {
      providerName: typeof body.providerName === 'string' ? body.providerName.trim() : '',
      planName: typeof body.planName === 'string' ? body.planName.trim() : '',
      coverageSummary: typeof body.coverageSummary === 'string' ? body.coverageSummary : null,
      durationMonths:
        typeof body.durationMonths === 'number' && Number.isFinite(body.durationMonths)
          ? body.durationMonths
          : null,
      priceUsd:
        typeof body.priceUsd === 'number' && Number.isFinite(body.priceUsd) ? body.priceUsd : null,
      currency: typeof body.currency === 'string' ? body.currency : 'USD',
      deductibleUsd:
        typeof body.deductibleUsd === 'number' && Number.isFinite(body.deductibleUsd)
          ? body.deductibleUsd
          : null,
      productCategory: typeof body.productCategory === 'string' ? body.productCategory : null,
      merchantId: typeof body.merchantId === 'string' ? body.merchantId : null,
      sourceUrl: typeof body.sourceUrl === 'string' ? body.sourceUrl : null,
      verifiedAt: typeof body.verifiedAt === 'string' ? body.verifiedAt : null,
      isActive: body.isActive === undefined ? true : body.isActive === true,
    };

    const validationError = validateWarrantyPlanInput(input);
    if (validationError) return badRequest(validationError);

    const supabase = await createSupabaseServerClient();
    // Missing table → honest 503, not a generic 500.
    const { error: probeError } = await supabase
      .from('warranty_plans')
      .select('id')
      .limit(1);
    if (probeError && isMissingTable(probeError)) {
      return serviceUnavailable(
        'Warranty plans are not set up yet — the owner still needs to run migration 033 (supabase/migrations/20261110130000_033_section6_nextgen.sql) once.'
      );
    }

    const created = await createWarrantyPlan(supabase, input);
    if (!created) return internalError('Failed to create warranty plan');
    return apiSuccess(created, 201, { warrantyEnabled: true });
  } catch {
    return internalError('Failed to create warranty plan');
  }
}
