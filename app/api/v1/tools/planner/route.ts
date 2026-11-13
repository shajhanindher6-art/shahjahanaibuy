/**
 * API v1 monthly planner — Section 7, item 4.
 * GET  /api/v1/tools/planner?month=YYYY-MM — the signed-in user's
 *        saved plan for that month (defaults to the current month),
 *        with its items. No plan yet → { plan: null, items: [] }.
 * POST /api/v1/tools/planner — build a plan from the user's monthly
 *        budget and product slugs. Decisions are computed server-side
 *        from recorded price history via the Buy vs Wait engine
 *        (lib/monthly-planner.ts) — the client never supplies its own
 *        decisions. The plan is upserted for (user, month); old items
 *        are replaced, never duplicated.
 *
 * Fail-safe: until the monthly_plans / plan_items tables exist,
 * GET returns { plan: null, items: [], plannerEnabled: false } and
 * POST returns 503 — never an error to the UI.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  apiSuccess,
  conflict,
  internalError,
  serviceUnavailable,
  validationError,
} from '@/lib/api/responses';
import { logApiRequest, rateLimitResponse, requireAuth } from '@/lib/api/middleware';
import { isMissingTableError } from '@/lib/agent-hunt';
import {
  buildMonthlyPlan,
  currentMonth,
  isValidMonth,
  predictFromPoints,
  type PlannerItemInput,
} from '@/lib/monthly-planner';

import { logApiError } from '@/lib/api/error-logging';
export const dynamic = 'force-dynamic';

const PLANS_NOT_READY =
  'Monthly planner is not set up yet — the owner still needs to run the Section 7 migration once in Supabase.';

/** 42P01 (missing table) or 42703 (missing column) → fail-safe, never a 500. */
function isMissingTableOrColumn(error: unknown): boolean {
  if (isMissingTableError(error)) return true;
  if (!error || typeof error !== 'object') return false;
  const code = (error as { code?: unknown }).code;
  return code === '42703';
}

export async function GET(request: NextRequest) {
  logApiRequest(request, { endpoint: 'tools.planner' });

  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  const limited = await rateLimitResponse(`tools-planner:${auth.userId}`, 30);
  if (limited) return limited;

  const monthParam = request.nextUrl.searchParams.get('month');
  const month = monthParam && isValidMonth(monthParam) ? monthParam : currentMonth();

  try {
    const supabase = await createSupabaseServerClient();
    const { data: plan, error: planError } = await supabase
      .from('monthly_plans')
      .select('id, user_id, month, budget_usd, created_at')
      .eq('user_id', auth.userId)
      .eq('month', month)
      .maybeSingle();
    if (planError) {
      if (isMissingTableOrColumn(planError)) {
        return apiSuccess({ plan: null, items: [], month, plannerEnabled: false });
      }
      return internalError('Failed to fetch monthly plan');
    }
    if (!plan) {
      return apiSuccess({ plan: null, items: [], month, plannerEnabled: true });
    }
    const { data: items, error: itemsError } = await supabase
      .from('plan_items')
      .select('id, plan_id, product_slug, decision, reason, created_at')
      .eq('plan_id', (plan as Record<string, unknown>).id)
      .order('created_at', { ascending: true });
    if (itemsError) {
      if (isMissingTableOrColumn(itemsError)) {
        return apiSuccess({ plan: null, items: [], month, plannerEnabled: false });
      }
      return internalError('Failed to fetch monthly plan');
    }
    return apiSuccess({ plan, items: items ?? [], month, plannerEnabled: true });
  } catch (err) {
    logApiError(err, { request, route: 'tools.planner.get', status: 500 });
    return internalError('Failed to fetch monthly plan');
  }
}

export async function POST(request: NextRequest) {
  logApiRequest(request, { endpoint: 'tools.planner.create' });

  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  const limited = await rateLimitResponse(`tools-planner:${auth.userId}`, 30);
  if (limited) return limited;

  try {
    const body = await request.json().catch(() => null);
    const month = typeof body?.month === 'string' && isValidMonth(body.month) ? body.month : currentMonth();
    const budgetUsd = body?.budget_usd;
    const rawSlugs = body?.product_slugs;

    if (typeof budgetUsd !== 'number' || !Number.isFinite(budgetUsd) || budgetUsd <= 0) {
      return validationError('budget_usd must be a number greater than 0.');
    }
    if (!Array.isArray(rawSlugs) || rawSlugs.length === 0 || rawSlugs.length > 50) {
      return validationError('product_slugs must be an array of 1 to 50 product slugs.');
    }
    const slugs = [...new Set(rawSlugs.filter((s): s is string => typeof s === 'string').map((s) => s.trim()).filter(Boolean))];
    if (slugs.length === 0) {
      return validationError('product_slugs must contain at least one non-empty slug.');
    }

    const supabase = await createSupabaseServerClient();

    const { data: products, error: productsError } = await supabase
      .from('products')
      .select('id, name, slug')
      .in('slug', slugs);
    if (productsError) return internalError('Failed to look up products');
    const productRows = (products ?? []) as Array<Record<string, unknown>>;
    const foundSlugs = new Set(productRows.map((p) => String(p.slug)));
    const unknown = slugs.filter((s) => !foundSlugs.has(s));
    if (unknown.length > 0) {
      return validationError(`Unknown product slug(s): ${unknown.join(', ')}. Use the slug from a product page URL.`);
    }

    const productIds = productRows.map((p) => String(p.id));
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const { data: history, error: historyError } = await supabase
      .from('price_history')
      .select('product_id, price, recorded_at')
      .in('product_id', productIds)
      .order('recorded_at', { ascending: true })
      .limit(2000);
    if (historyError) return internalError('Failed to fetch price history');
    const historyRows = (history ?? []) as Array<Record<string, unknown>>;

    const byProduct = new Map<string, Array<{ price: number; recordedAt: string }>>();
    for (const row of historyRows) {
      const price = typeof row.price === 'number' ? row.price : parseFloat(String(row.price));
      if (!Number.isFinite(price) || price <= 0) continue;
      const list = byProduct.get(String(row.product_id)) ?? [];
      list.push({ price, recordedAt: String(row.recorded_at) });
      byProduct.set(String(row.product_id), list);
    }

    const inputs: PlannerItemInput[] = productRows.map((p) => {
      const pts = byProduct.get(String(p.id)) ?? [];
      const currentPrice = pts.length > 0 ? pts[pts.length - 1].price : null;
      const recent = pts.filter((pt) => Date.parse(pt.recordedAt) >= thirtyDaysAgo.getTime());
      const lowest30dPrice =
        recent.length > 0 ? Math.min(...recent.map((pt) => pt.price)) : null;
      return {
        productSlug: String(p.slug),
        productName: String(p.name),
        currentPrice,
        lowest30dPrice,
        prediction: pts.length > 0 ? predictFromPoints(pts) : null,
      };
    });

    const plan = buildMonthlyPlan(inputs, budgetUsd);

    const { data: savedPlan, error: upsertError } = await supabase
      .from('monthly_plans')
      .upsert(
        { user_id: auth.userId, month, budget_usd: Math.round(budgetUsd * 100) / 100 },
        { onConflict: 'user_id,month' }
      )
      .select('id, user_id, month, budget_usd, created_at')
      .single();
    if (upsertError) {
      if (isMissingTableOrColumn(upsertError)) {
        return serviceUnavailable(PLANS_NOT_READY);
      }
      return internalError('Failed to save monthly plan');
    }
    const planId = String((savedPlan as Record<string, unknown>).id);

    const { error: deleteError } = await supabase
      .from('plan_items')
      .delete()
      .eq('plan_id', planId);
    if (deleteError) {
      if (isMissingTableOrColumn(deleteError)) {
        return serviceUnavailable(PLANS_NOT_READY);
      }
      return internalError('Failed to save monthly plan');
    }

    const { data: savedItems, error: insertError } = await supabase
      .from('plan_items')
      .insert(
        plan.items.map((item) => ({
          plan_id: planId,
          product_slug: item.productSlug,
          decision: item.decision,
          reason: item.reason,
        }))
      )
      .select('id, plan_id, product_slug, decision, reason, created_at');
    if (insertError) {
      if (isMissingTableOrColumn(insertError)) {
        return serviceUnavailable(PLANS_NOT_READY);
      }
      if ((insertError as { code?: string }).code === '23505') {
        return conflict('A plan item for one of these products already exists for this month.');
      }
      return internalError('Failed to save monthly plan');
    }

    return apiSuccess(
      {
        plan: savedPlan,
        items: savedItems ?? [],
        month,
        plannerEnabled: true,
        buyNowTotalUsd: plan.buyNowTotalUsd,
        waitTotalUsd: plan.waitTotalUsd,
        nextMonthTotalUsd: plan.nextMonthTotalUsd,
        remainingBudgetUsd: plan.remainingBudgetUsd,
      },
      201
    );
  } catch (err) {
    logApiError(err, { request, route: 'tools.planner.post', status: 500 });
    return internalError('Failed to build monthly plan');
  }
}
