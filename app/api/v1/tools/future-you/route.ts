/**
 * API v1 Future You planner — Section 7, item 20 (spec item 13 in
 * the Section 7 combined batch).
 * GET  /api/v1/tools/future-you — the signed-in user's saving goals,
 *        each with its monthly saving COMPUTED at read time
 *        ((target − saved so far) ÷ months remaining; saved so far
 *        is $0 here — no saved amount is stored for a goal) plus,
 *        when the goal names a product, that product's current
 *        recorded price and whether the user has an active alert
 *        for it. Missing data → honest empty state, never invented.
 * POST /api/v1/tools/future-you — create a goal. Monthly saving is
 *        never stored; it is derived on every read.
 *
 * Fail-safe: until the future_you_goals table exists, GET returns
 * { goals: [], futureYouEnabled: false } and POST returns 503.
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
import { planFutureYou, validateFutureYouGoal } from '@/lib/future-you';

export const dynamic = 'force-dynamic';

const GOALS_NOT_READY =
  'Future You planner is not set up yet — the owner still needs to run the Section 7 migration once in Supabase.';

/** 42P01 (missing table) or 42703 (missing column) → fail-safe, never a 500. */
function isMissingTableOrColumn(error: unknown): boolean {
  if (isMissingTableError(error)) return true;
  if (!error || typeof error !== 'object') return false;
  return (error as { code?: unknown }).code === '42703';
}

interface GoalRow {
  id: string;
  user_id: string;
  name: string;
  target_usd: number | string;
  target_date: string;
  product_slug: string | null;
  created_at: string;
}

export async function GET(request: NextRequest) {
  logApiRequest(request, { endpoint: 'tools.future-you' });

  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  const limited = await rateLimitResponse(`tools-future-you:${auth.userId}`, 30);
  if (limited) return limited;

  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from('future_you_goals')
      .select('id, user_id, name, target_usd, target_date, product_slug, created_at')
      .eq('user_id', auth.userId)
      .order('created_at', { ascending: false });
    if (error) {
      if (isMissingTableOrColumn(error)) {
        return apiSuccess({ goals: [], futureYouEnabled: false });
      }
      return internalError('Failed to fetch saving goals');
    }
    const goals = (data ?? []) as GoalRow[];

    // Enrich goals that name a product: current recorded price +
    // whether the user has an active alert for that product.
    const slugs = [...new Set(goals.map((g) => g.product_slug).filter((s): s is string => !!s))];
    const productBySlug = new Map<string, { id: string; name: string; slug: string }>();
    if (slugs.length > 0) {
      const { data: products } = await supabase
        .from('products')
        .select('id, name, slug')
        .in('slug', slugs);
      for (const p of (products ?? []) as Array<Record<string, unknown>>) {
        productBySlug.set(String(p.slug), {
          id: String(p.id),
          name: String(p.name),
          slug: String(p.slug),
        });
      }
    }
    const productIds = [...productBySlug.values()].map((p) => p.id);
    const priceByProduct = new Map<string, number>();
    const alertProductIds = new Set<string>();
    if (productIds.length > 0) {
      const [{ data: prices }, { data: alerts }] = await Promise.all([
        supabase
          .from('price_history')
          .select('product_id, price, recorded_at')
          .in('product_id', productIds)
          .order('recorded_at', { ascending: false })
          .limit(productIds.length * 5),
        supabase
          .from('alerts')
          .select('product_id')
          .eq('user_id', auth.userId)
          .eq('active', true)
          .in('product_id', productIds),
      ]);
      // Latest price per product (rows arrive newest-first).
      for (const row of (prices ?? []) as Array<Record<string, unknown>>) {
        const pid = String(row.product_id);
        if (priceByProduct.has(pid)) continue;
        const price = typeof row.price === 'number' ? row.price : parseFloat(String(row.price));
        if (Number.isFinite(price) && price > 0) priceByProduct.set(pid, price);
      }
      for (const row of (alerts ?? []) as Array<Record<string, unknown>>) {
        alertProductIds.add(String(row.product_id));
      }
    }

    const enriched = goals.map((goal) => {
      const targetUsd =
        typeof goal.target_usd === 'number'
          ? goal.target_usd
          : parseFloat(String(goal.target_usd));
      const plan = planFutureYou({
        targetUsd: Number.isFinite(targetUsd) ? targetUsd : 0,
        savedSoFarUsd: 0,
        targetDate: goal.target_date,
      });
      const product = goal.product_slug ? productBySlug.get(goal.product_slug) : undefined;
      return {
        id: goal.id,
        name: goal.name,
        targetUsd: Number.isFinite(targetUsd) ? targetUsd : 0,
        targetDate: goal.target_date,
        productSlug: goal.product_slug,
        createdAt: goal.created_at,
        // Saved so far is not stored for a goal — the plan below
        // assumes $0 saved; the page lets the user preview with
        // their own saved amount without storing it.
        savedSoFarUsd: 0,
        plan,
        product: product
          ? {
              name: product.name,
              slug: product.slug,
              currentPriceUsd: priceByProduct.get(product.id) ?? null,
              hasActiveAlert: alertProductIds.has(product.id),
            }
          : null,
      };
    });

    return apiSuccess({ goals: enriched, futureYouEnabled: true });
  } catch {
    return internalError('Failed to fetch saving goals');
  }
}

export async function POST(request: NextRequest) {
  logApiRequest(request, { endpoint: 'tools.future-you.create' });

  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  const limited = await rateLimitResponse(`tools-future-you:${auth.userId}`, 30);
  if (limited) return limited;

  try {
    const body = await request.json().catch(() => null);
    const input = {
      name: body?.name,
      targetUsd: body?.target_usd,
      targetDate: body?.target_date,
      productSlug:
        typeof body?.product_slug === 'string' && body.product_slug.trim()
          ? body.product_slug.trim()
          : undefined,
    };
    const errors = validateFutureYouGoal(input);
    if (errors.length > 0) return validationError(errors.join(' '));

    const supabase = await createSupabaseServerClient();

    if (input.productSlug) {
      const { data: product, error: productError } = await supabase
        .from('products')
        .select('id')
        .eq('slug', input.productSlug)
        .maybeSingle();
      if (productError) return internalError('Failed to look up product');
      if (!product) {
        return validationError(
          `Unknown product slug: ${input.productSlug}. Use the slug from a product page URL.`
        );
      }
    }

    const { data, error } = await supabase
      .from('future_you_goals')
      .insert({
        user_id: auth.userId,
        name: input.name.trim(),
        target_usd: Math.round(input.targetUsd * 100) / 100,
        target_date: input.targetDate,
        product_slug: input.productSlug ?? null,
      })
      .select('id, user_id, name, target_usd, target_date, product_slug, created_at')
      .single();
    if (error) {
      if (isMissingTableOrColumn(error)) {
        return serviceUnavailable(GOALS_NOT_READY);
      }
      if ((error as { code?: string }).code === '23505') {
        return conflict('A saving goal with this name already exists.');
      }
      return internalError('Failed to create saving goal');
    }

    const goal = data as GoalRow;
    const targetUsd =
      typeof goal.target_usd === 'number' ? goal.target_usd : parseFloat(String(goal.target_usd));
    return apiSuccess(
      {
        goal: {
          id: goal.id,
          name: goal.name,
          targetUsd: Number.isFinite(targetUsd) ? targetUsd : 0,
          targetDate: goal.target_date,
          productSlug: goal.product_slug,
          createdAt: goal.created_at,
          savedSoFarUsd: 0,
          plan: planFutureYou({
            targetUsd: Number.isFinite(targetUsd) ? targetUsd : 0,
            savedSoFarUsd: 0,
            targetDate: goal.target_date,
          }),
          product: null,
        },
        futureYouEnabled: true,
      },
      201
    );
  } catch {
    return internalError('Failed to create saving goal');
  }
}
