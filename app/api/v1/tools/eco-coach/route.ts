/**
 * API v1 eco coach (Section 7, item 15 — AI Eco Shopping Coach).
 * GET  /api/v1/tools/eco-coach?month=YYYY-MM&productSlug=... — the
 *        signed-in user's carbon budget + monthly spend for the
 *        month, with an optional per-purchase coach note (auth).
 * POST /api/v1/tools/eco-coach — save the monthly carbon budget
 *        (auth). Recorded carbon first; estimates are always
 *        labeled "Estimate only — not a certified lifecycle
 *        assessment"; unknown carbon adds nothing.
 *
 * Fail-safe: if the eco_budgets migration has not been run, GET
 * returns the spend with budgetEnabled:false and POST answers 503.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  apiSuccess,
  badRequest,
  internalError,
  serviceUnavailable,
} from '@/lib/api/responses';
import { logApiRequest, requireAuth, rateLimitResponse, getClientIp } from '@/lib/api/middleware';
import {
  budgetStatus,
  currentMonth,
  getCoachNoteForProduct,
  getEcoBudget,
  getMonthlyCarbonSpend,
  isValidMonth,
  normalizeBudgetKg,
  saveEcoBudget,
} from '@/lib/eco-coach';

export const dynamic = 'force-dynamic';

const MISSING_TABLE_MESSAGE =
  'Carbon budgets are not set up yet — the owner still needs to run the Section 7 migration (eco_budgets table) once.';

export async function GET(request: NextRequest) {
  logApiRequest(request, { endpoint: 'tools.eco-coach' });
  const limited = await rateLimitResponse(`tools.eco-coach:${getClientIp(request)}`, 30);
  if (limited) return limited;

  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  const monthParam = request.nextUrl.searchParams.get('month');
  const month = monthParam && isValidMonth(monthParam) ? monthParam : currentMonth();
  const productSlug = request.nextUrl.searchParams.get('productSlug');

  try {
    const supabase = await createSupabaseServerClient();
    const [{ budget, enabled: budgetEnabled }, spend] = await Promise.all([
      getEcoBudget(supabase, auth.userId, month),
      getMonthlyCarbonSpend(supabase, auth.userId, month),
    ]);
    const status =
      budget && budget.budget_kg > 0
        ? budgetStatus(spend.purchaseCount === 0 ? null : spend.totalKg, budget.budget_kg)
        : null;
    let coachNote = null;
    if (productSlug) {
      coachNote = await getCoachNoteForProduct(supabase, productSlug, status);
      if (!coachNote) return badRequest('productSlug is not in the catalog');
    }
    return apiSuccess({ month, budget, spend, budgetStatus: status, coachNote }, 200, {
      budgetEnabled,
    });
  } catch (err) {
    console.error('[tools.eco-coach] unexpected error', err);
    return internalError('Failed to fetch the eco coach');
  }
}

export async function POST(request: NextRequest) {
  logApiRequest(request, { endpoint: 'tools.eco-coach.save' });
  const limited = await rateLimitResponse(`tools.eco-coach:${getClientIp(request)}`, 30);
  if (limited) return limited;

  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  try {
    const body = await request.json().catch(() => null);
    const month =
      typeof body?.month === 'string' && isValidMonth(body.month) ? body.month : currentMonth();
    if (body?.month !== undefined && !isValidMonth(body.month)) {
      return badRequest('month must be YYYY-MM');
    }
    const budgetKg = normalizeBudgetKg(body?.budgetKg);
    if (budgetKg === null) {
      return badRequest('budgetKg must be a number greater than 0 (kg CO2e per month).');
    }

    const supabase = await createSupabaseServerClient();
    const result = await saveEcoBudget(supabase, auth.userId, month, budgetKg);
    if ('error' in result) {
      if (result.missingTable) return serviceUnavailable(MISSING_TABLE_MESSAGE);
      return internalError(result.error.message);
    }
    return apiSuccess({ budget: result.budget, deduped: result.deduped });
  } catch (err) {
    console.error('[tools.eco-coach] unexpected error', err);
    return internalError('Failed to save the carbon budget');
  }
}
