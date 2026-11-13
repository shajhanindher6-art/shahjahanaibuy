/**
 * API v1 autonomous deal hunts — Section 6, item 2.
 * GET  /api/v1/agent/hunts — the signed-in user's hunts + latest matches.
 * POST /api/v1/agent/hunts — create a hunt from the user's STATED
 *        agent_memory preferences (category / budget / brands), with
 *        optional per-hunt overrides in the body. A hunt needs a
 *        stated budget — from the body or from memory — otherwise it
 *        would match everything, so the create is rejected.
 *
 * Hunts never match on their own: they run only inside the existing
 * 6-hour price refresh chain (lib/agent-hunt.ts), for users who
 * granted agent-memory consent. Matches require a real recorded
 * in-stock price at or under the stated budget — never invented.
 *
 * Fail-safe: until migration 033 is run, GET returns
 * { hunts: [], matches: [], huntsEnabled: false } and POST returns 503.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  apiSuccess,
  internalError,
  serviceUnavailable,
  validationError,
} from '@/lib/api/responses';
import { logApiRequest, rateLimitResponse, requireAuth } from '@/lib/api/middleware';
import { AGENT_CATEGORIES } from '@/lib/agent-memory';
import {
  isMissingTableError,
  mapHuntMatchRow,
  mapHuntRow,
} from '@/lib/agent-hunt';
import { isMissingTableError as isMissingAgentTable, mapMemoryRow } from '../shared';

import { logApiError } from '@/lib/api/error-logging';
export const dynamic = 'force-dynamic';

const HUNT_COLUMNS =
  'id, user_id, category, max_budget_usd, preferred_brands, active, last_run_at, created_at';

function cleanStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const cleaned = (value as unknown[])
    .filter((v): v is string => typeof v === 'string' && v.trim() !== '')
    .map((v) => v.trim());
  return cleaned.length > 0 ? cleaned : null;
}

export async function GET(request: NextRequest) {
  logApiRequest(request, { endpoint: 'agent.hunts' });

  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  const limited = await rateLimitResponse(`agent-hunts:${auth.userId}`, 30);
  if (limited) return limited;

  try {
    const supabase = await createSupabaseServerClient();
    const { data: huntsData, error: huntsError } = await supabase
      .from('agent_hunts')
      .select(HUNT_COLUMNS)
      .eq('user_id', auth.userId)
      .order('created_at', { ascending: false });
    if (huntsError) {
      if (isMissingTableError(huntsError)) {
        return apiSuccess({ hunts: [], matches: [], huntsEnabled: false });
      }
      return internalError('Failed to fetch agent hunts');
    }

    const { data: matchesData, error: matchesError } = await supabase
      .from('hunt_matches')
      .select('id, hunt_id, user_id, product_id, matched_price_usd, matched_at')
      .eq('user_id', auth.userId)
      .order('matched_at', { ascending: false })
      .limit(20);
    if (matchesError) {
      if (isMissingTableError(matchesError)) {
        return apiSuccess({
          hunts: (huntsData ?? []).map((row) => mapHuntRow(row as Record<string, unknown>)),
          matches: [],
          huntsEnabled: false,
        });
      }
      return internalError('Failed to fetch hunt matches');
    }

    const productIds = [...new Set(((matchesData ?? []) as Array<Record<string, unknown>>).map((r) => String(r.product_id)))];
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

    return apiSuccess({
      hunts: (huntsData ?? []).map((row) => mapHuntRow(row as Record<string, unknown>)),
      matches: (matchesData ?? []).map((row) => mapHuntMatchRow(row as Record<string, unknown>, productById)),
      huntsEnabled: true,
    });
  } catch (err) {
    logApiError(err, { request, route: 'agent.hunts.get', status: 500 });
    return internalError('Failed to fetch agent hunts');
  }
}

export async function POST(request: NextRequest) {
  logApiRequest(request, { endpoint: 'agent.hunts.create' });

  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  const limited = await rateLimitResponse(`agent-hunts:${auth.userId}`, 30);
  if (limited) return limited;

  try {
    const body = await request.json().catch(() => null);
    const category = typeof body?.category === 'string' ? body.category.trim() : null;
    const maxBudgetUsd =
      typeof body?.maxBudgetUsd === 'number' && Number.isFinite(body.maxBudgetUsd) ? body.maxBudgetUsd : null;
    const preferredBrands = cleanStringArray(body?.preferredBrands);

    if (category && !(AGENT_CATEGORIES as readonly string[]).includes(category)) {
      return validationError(`category must be one of: ${AGENT_CATEGORIES.join(', ')}.`);
    }
    if (maxBudgetUsd !== null && maxBudgetUsd <= 0) {
      return validationError('maxBudgetUsd must be a number greater than 0.');
    }

    const supabase = await createSupabaseServerClient();

    // Copy the user's STATED preferences when the body omits a field.
    let memoryBudget: number | null = null;
    let memoryCategories: string[] | null = null;
    let memoryBrands: string[] | null = null;
    const { data: memoryData, error: memoryError } = await supabase
      .from('agent_memory')
      .select('id, user_id, preferences, seen_product_slugs, consent_granted_at, created_at, updated_at')
      .eq('user_id', auth.userId)
      .maybeSingle();
    if (memoryError) {
      if (isMissingAgentTable(memoryError)) {
        return serviceUnavailable('Agent hunts are not set up yet — the owner still needs to run migration 033 once.');
      }
      return internalError('Failed to create agent hunt');
    }
    if (memoryData) {
      const memory = mapMemoryRow(memoryData as Record<string, unknown>);
      memoryBudget = memory.preferences.maxBudgetUsd ?? null;
      memoryCategories = memory.preferences.categories ?? null;
      memoryBrands = memory.preferences.preferredBrands ?? null;
    }

    const finalBudget = maxBudgetUsd ?? memoryBudget;
    if (finalBudget === null || finalBudget <= 0) {
      return validationError(
        'A hunt needs a stated max budget — pass maxBudgetUsd, or set one in your agent preferences first.'
      );
    }
    const finalCategory = category ?? memoryCategories?.[0] ?? null;
    const finalBrands = preferredBrands ?? memoryBrands;

    const { data, error } = await supabase
      .from('agent_hunts')
      .insert({
        user_id: auth.userId,
        category: finalCategory,
        max_budget_usd: finalBudget,
        preferred_brands: finalBrands,
        active: true,
      })
      .select(HUNT_COLUMNS)
      .single();
    if (error) {
      if (isMissingTableError(error)) {
        return serviceUnavailable('Agent hunts are not set up yet — the owner still needs to run migration 033 once.');
      }
      return internalError('Failed to create agent hunt');
    }
    return apiSuccess({ hunt: mapHuntRow(data as Record<string, unknown>), huntsEnabled: true }, 201);
  } catch (err) {
    logApiError(err, { request, route: 'agent.hunts.post', status: 500 });
    return internalError('Failed to create agent hunt');
  }
}
