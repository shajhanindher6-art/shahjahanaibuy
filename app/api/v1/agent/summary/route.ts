/**
 * API v1 agent deal-summary endpoint (S5#1).
 * GET /api/v1/agent/summary — a ready deal summary for the
 * signed-in user's agent: which watched products are at or under
 * their target prices, and which are within their stated budget.
 *
 * Prices are the LOWEST RECORDED IN-STOCK merchant prices from
 * `merchant_products` — the same recorded data the product pages
 * show. They are NOT live retailer prices, and the response says
 * so in `priceBasis`. A product with no recorded in-stock price
 * is reported as unknown, never priced by guesswork.
 *
 * Fail-safe: until migration 027 is run, returns an honest empty
 * summary with setupRequired: true.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess, internalError } from '@/lib/api/responses';
import { logApiRequest, rateLimitResponse, requireAuth } from '@/lib/api/middleware';
import {
  summarizeDealsForMemory,
  type WatchedProductState,
} from '@/lib/agent-memory';
import {
  isMissingTableError as isMissingHuntTable,
  mapHuntMatchRow,
  type HuntMatch,
} from '@/lib/agent-hunt';
import type { AnySupabaseClient } from '@/lib/supabase/types';
import { isMissingTableError, mapMemoryRow, mapRuleRow } from '../shared';

import { logApiError } from '@/lib/api/error-logging';
export const dynamic = 'force-dynamic';

/** Max watched products priced in one summary (rules first, then seen). */
const MAX_WATCHED = 20;

/**
 * Latest hunt matches for the summary (S6#2). Missing migration 033
 * table → empty array + huntsEnabled: false; any other failure →
 * empty array (the deal summary must never break over hunts).
 */
async function loadHuntMatches(
  supabase: AnySupabaseClient,
  userId: string
): Promise<{ huntMatches: HuntMatch[]; huntsEnabled: boolean }> {
  try {
    const { data, error } = await supabase
      .from('hunt_matches')
      .select('id, hunt_id, user_id, product_id, matched_price_usd, matched_at')
      .eq('user_id', userId)
      .order('matched_at', { ascending: false })
      .limit(20);
    if (error) {
      return { huntMatches: [], huntsEnabled: !isMissingHuntTable(error) };
    }
    const rows = (data ?? []) as Array<Record<string, unknown>>;
    const productIds = [...new Set(rows.map((r) => String(r.product_id)))];
    const productById = new Map<string, { slug: string; name: string }>();
    if (productIds.length > 0) {
      const { data: productsData } = await supabase
        .from('products')
        .select('id, slug, name')
        .in('id', productIds);
      for (const row of (productsData ?? []) as Array<Record<string, unknown>>) {
        productById.set(String(row.id), { slug: String(row.slug), name: String(row.name) });
      }
    }
    return {
      huntMatches: rows.map((row) => mapHuntMatchRow(row, productById)),
      huntsEnabled: true,
    };
  } catch {
    return { huntMatches: [], huntsEnabled: false };
  }
}

export async function GET(request: NextRequest) {
  logApiRequest(request, { endpoint: 'agent.summary' });

  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  const limited = await rateLimitResponse(`agent-summary:${auth.userId}`, 30);
  if (limited) return limited;

  try {
    const supabase = await createSupabaseServerClient();

    // S6#2: latest hunt matches (fail-safe — never breaks the summary).
    const { huntMatches, huntsEnabled } = await loadHuntMatches(supabase, auth.userId);

    const { data: memoryData, error: memoryError } = await supabase
      .from('agent_memory')
      .select('id, user_id, preferences, seen_product_slugs, consent_granted_at, created_at, updated_at')
      .eq('user_id', auth.userId)
      .maybeSingle();

    if (memoryError) {
      if (isMissingTableError(memoryError)) {
        return apiSuccess({
          summary: {
            text: 'Agent memory is not set up yet — migration 027 has not been run.',
            items: [],
            metCount: 0,
            watchedCount: 0,
            unknownCount: 0,
          },
          setupRequired: true,
          huntMatches,
          huntsEnabled,
          generatedAt: new Date().toISOString(),
          priceBasis: 'Lowest recorded in-stock merchant price — not a live retailer price.',
        });
      }
      return internalError('Failed to build agent summary');
    }

    const { data: rulesData, error: rulesError } = await supabase
      .from('agent_rules')
      .select('id, user_id, product_id, product_slug, product_name, target_price_usd, channel, alert_id, active, last_triggered_at, trigger_count, created_at, updated_at')
      .eq('user_id', auth.userId)
      .eq('active', true)
      .order('created_at', { ascending: false });

    if (rulesError) {
      if (isMissingTableError(rulesError)) {
        return apiSuccess({
          summary: {
            text: 'Agent memory is not set up yet — migration 027 has not been run.',
            items: [],
            metCount: 0,
            watchedCount: 0,
            unknownCount: 0,
          },
          setupRequired: true,
          huntMatches,
          huntsEnabled,
          generatedAt: new Date().toISOString(),
          priceBasis: 'Lowest recorded in-stock merchant price — not a live retailer price.',
        });
      }
      return internalError('Failed to build agent summary');
    }

    const memory = memoryData ? mapMemoryRow(memoryData as Record<string, unknown>) : null;
    const rules = (rulesData ?? []).map((row) => mapRuleRow(row as Record<string, unknown>));

    // Watched set: active rules first, then seen products (no
    // target), deduped by slug, capped.
    const watchedBySlug = new Map<string, { name: string; targetPriceUsd: number | null }>();
    for (const rule of rules) {
      watchedBySlug.set(rule.productSlug, {
        name: rule.productName ?? rule.productSlug,
        targetPriceUsd: rule.targetPriceUsd,
      });
    }
    if (memory) {
      for (const slug of memory.seenProductSlugs) {
        if (watchedBySlug.size >= MAX_WATCHED) break;
        if (!watchedBySlug.has(slug)) {
          watchedBySlug.set(slug, { name: slug, targetPriceUsd: null });
        }
      }
    }
    const watchedSlugs = [...watchedBySlug.keys()];
    if (watchedSlugs.length === 0) {
      const summary = summarizeDealsForMemory([], memory?.preferences ?? {});
      return apiSuccess({
        summary,
        setupRequired: false,
        huntMatches,
        huntsEnabled,
        generatedAt: new Date().toISOString(),
        priceBasis: 'Lowest recorded in-stock merchant price — not a live retailer price.',
      });
    }

    // Resolve slugs to product ids + display names in one query.
    const { data: productsData } = await supabase
      .from('products')
      .select('id, slug, name')
      .in('slug', watchedSlugs)
      .is('deleted_at', null);
    const idBySlug = new Map<string, { id: string; name: string }>();
    for (const row of (productsData ?? []) as Array<Record<string, unknown>>) {
      idBySlug.set(String(row.slug), { id: String(row.id), name: String(row.name) });
    }

    // Lowest recorded in-stock price per product, one query.
    const productIds = [...idBySlug.values()].map((p) => p.id);
    const lowestByProductId = new Map<string, number>();
    if (productIds.length > 0) {
      const { data: listings } = await supabase
        .from('merchant_products')
        .select('product_id, price')
        .in('product_id', productIds)
        .is('deleted_at', null)
        .eq('in_stock', true)
        .order('price', { ascending: true });
      for (const row of (listings ?? []) as Array<Record<string, unknown>>) {
        const pid = String(row.product_id);
        if (lowestByProductId.has(pid)) continue;
        const price = typeof row.price === 'number' ? row.price : parseFloat(String(row.price));
        if (Number.isFinite(price)) lowestByProductId.set(pid, price);
      }
    }

    const watched: WatchedProductState[] = watchedSlugs.map((slug) => {
      const meta = watchedBySlug.get(slug) as { name: string; targetPriceUsd: number | null };
      const resolved = idBySlug.get(slug);
      return {
        slug,
        name: resolved?.name ?? meta.name,
        currentPriceUsd: resolved ? (lowestByProductId.get(resolved.id) ?? null) : null,
        targetPriceUsd: meta.targetPriceUsd,
      };
    });

    const summary = summarizeDealsForMemory(watched, memory?.preferences ?? {});
    return apiSuccess({
      summary,
      setupRequired: false,
      huntMatches,
      huntsEnabled,
      generatedAt: new Date().toISOString(),
      priceBasis: 'Lowest recorded in-stock merchant price — not a live retailer price.',
    });
  } catch (err) {
    logApiError(err, { request, route: 'agent.summary', status: 500 });
    return internalError('Failed to build agent summary');
  }
}
