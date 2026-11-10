/**
 * Warranty & insurance plans (Section 6, item 12).
 *
 * Admin-recorded plans only (migration 033 `warranty_plans`).
 * Every value column is NULL until an admin copies it from the
 * provider's own published page with a source_url. No plan is ever
 * recommended; coverage is never stated unless recorded; a price is
 * never invented. Fail-safe reads: when migration 033 has not been
 * run yet (PostgREST PGRST205 / Postgres 42P01) the reads return
 * [] — the UI then shows the honest empty state, never a crash.
 *
 * The manufacturer warranty is NOT a plan: it lives in its own
 * labelled column/field wherever plans are rendered, never merged
 * into a third-party plan row.
 */

import type { AnySupabaseClient } from '@/lib/supabase/types';
import { logger } from '@/lib/config/logger';

// PostgREST reports a table missing from its schema cache as
// PGRST205 (not Postgres 42P01) on the REST path, so both codes
// must count as "migration not run yet".
export function isMissingTable(error: { code?: string } | null | undefined): boolean {
  return error?.code === '42P01' || error?.code === 'PGRST205';
}

export interface WarrantyPlan {
  id: string;
  providerName: string;
  planName: string;
  coverageSummary: string | null;
  durationMonths: number | null;
  priceUsd: number | null;
  currency: string;
  deductibleUsd: number | null;
  productCategory: string | null;
  merchantId: string | null;
  sourceUrl: string | null;
  verifiedAt: string | null;
  isActive: boolean;
  createdAt: string | null;
}

export interface WarrantyPlanInput {
  providerName: string;
  planName: string;
  coverageSummary?: string | null;
  durationMonths?: number | null;
  priceUsd?: number | null;
  currency?: string;
  deductibleUsd?: number | null;
  productCategory?: string | null;
  merchantId?: string | null;
  sourceUrl?: string | null;
  verifiedAt?: string | null;
  isActive?: boolean;
}

function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toStringOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s !== '' ? s : null;
}

/** Map one DB row (snake_case) to a WarrantyPlan (camelCase). */
export function mapWarrantyPlanRow(row: Record<string, unknown>): WarrantyPlan {
  return {
    id: String(row.id),
    providerName: String(row.provider_name ?? ''),
    planName: String(row.plan_name ?? ''),
    coverageSummary: toStringOrNull(row.coverage_summary),
    durationMonths: toNumberOrNull(row.duration_months),
    priceUsd: toNumberOrNull(row.price_usd),
    currency: typeof row.currency === 'string' && row.currency.trim() !== '' ? row.currency : 'USD',
    deductibleUsd: toNumberOrNull(row.deductible_usd),
    productCategory: toStringOrNull(row.product_category),
    merchantId: toStringOrNull(row.merchant_id),
    sourceUrl: toStringOrNull(row.source_url),
    verifiedAt: toStringOrNull(row.verified_at),
    isActive: row.is_active === true,
    createdAt: toStringOrNull(row.created_at),
  };
}

/**
 * Validate admin-supplied plan input. Provider + plan names are
 * required; numeric fields must be valid when given (price > 0,
 * deductible >= 0, duration >= 0); a source URL must be http(s)
 * when given. Returns an error message, or null when valid.
 */
export function validateWarrantyPlanInput(input: WarrantyPlanInput): string | null {
  if (!input.providerName || input.providerName.trim() === '') {
    return 'providerName is required.';
  }
  if (!input.planName || input.planName.trim() === '') {
    return 'planName is required.';
  }
  if (input.priceUsd !== null && input.priceUsd !== undefined) {
    if (!Number.isFinite(input.priceUsd) || input.priceUsd <= 0) {
      return 'priceUsd must be greater than 0 when recorded.';
    }
  }
  if (input.deductibleUsd !== null && input.deductibleUsd !== undefined) {
    if (!Number.isFinite(input.deductibleUsd) || input.deductibleUsd < 0) {
      return 'deductibleUsd must be 0 or greater when recorded.';
    }
  }
  if (input.durationMonths !== null && input.durationMonths !== undefined) {
    if (!Number.isFinite(input.durationMonths) || input.durationMonths < 0) {
      return 'durationMonths must be 0 or greater when recorded.';
    }
  }
  if (input.sourceUrl) {
    try {
      const u = new URL(input.sourceUrl);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('bad protocol');
    } catch {
      return 'sourceUrl must be a valid http(s) URL.';
    }
  }
  return null;
}

function toDbRow(input: WarrantyPlanInput): Record<string, unknown> {
  return {
    provider_name: input.providerName.trim(),
    plan_name: input.planName.trim(),
    coverage_summary: input.coverageSummary?.trim() ? input.coverageSummary.trim() : null,
    duration_months: input.durationMonths ?? null,
    price_usd: input.priceUsd ?? null,
    currency: input.currency?.trim() ? input.currency.trim() : 'USD',
    deductible_usd: input.deductibleUsd ?? null,
    product_category: input.productCategory?.trim() ? input.productCategory.trim() : null,
    merchant_id: input.merchantId?.trim() ? input.merchantId.trim() : null,
    source_url: input.sourceUrl?.trim() ? input.sourceUrl.trim() : null,
    verified_at: input.verifiedAt?.trim() ? input.verifiedAt.trim() : null,
    is_active: input.isActive ?? true,
  };
}

/**
 * Active recorded plans, optionally filtered by recorded category,
 * sorted by recorded price_usd ascending with unpriced plans last
 * (NULLS LAST) — an unpriced plan is never sorted as if it were
 * free. Returns [] when migration 033 has not been run yet or the
 * query fails.
 */
export async function getWarrantyPlansByCategory(
  supabase: AnySupabaseClient,
  category?: string | null
): Promise<WarrantyPlan[]> {
  try {
    let query = supabase
      .from('warranty_plans')
      .select(
        'id, provider_name, plan_name, coverage_summary, duration_months, price_usd, currency, deductible_usd, product_category, merchant_id, source_url, verified_at, is_active, created_at'
      )
      .eq('is_active', true)
      .order('price_usd', { ascending: true, nullsFirst: false });
    if (category && category.trim() !== '') {
      query = query.eq('product_category', category.trim());
    }
    const { data, error } = await query;
    if (error || !data) {
      if (error && !isMissingTable(error)) {
        logger.warn('getWarrantyPlansByCategory: query failed', { error: error.message });
      }
      return [];
    }
    return (data as Array<Record<string, unknown>>).map(mapWarrantyPlanRow);
  } catch (err) {
    logger.error('getWarrantyPlansByCategory: unexpected error', { error: String(err) });
    return [];
  }
}

/**
 * Admin create helper. Admin enforcement lives in the route
 * (requireAdmin) — this helper only validates and inserts.
 * Returns the created plan, or null when the table is missing
 * (migration 033 not run) or the insert fails.
 */
export async function createWarrantyPlan(
  supabase: AnySupabaseClient,
  input: WarrantyPlanInput
): Promise<WarrantyPlan | null> {
  if (validateWarrantyPlanInput(input) !== null) return null;
  try {
    const { data, error } = await supabase
      .from('warranty_plans')
      .insert(toDbRow(input))
      .select(
        'id, provider_name, plan_name, coverage_summary, duration_months, price_usd, currency, deductible_usd, product_category, merchant_id, source_url, verified_at, is_active, created_at'
      )
      .single();
    if (error || !data) {
      if (error && !isMissingTable(error)) {
        logger.warn('createWarrantyPlan: insert failed', { error: error.message });
      }
      return null;
    }
    return mapWarrantyPlanRow(data as Record<string, unknown>);
  } catch (err) {
    logger.error('createWarrantyPlan: unexpected error', { error: String(err) });
    return null;
  }
}

/**
 * Admin update helper (partial — only the fields present in
 * `patch` are changed). Returns the updated plan, or null when
 * the plan is missing, the table is missing, or the update fails.
 */
export async function updateWarrantyPlan(
  supabase: AnySupabaseClient,
  id: string,
  patch: Partial<WarrantyPlanInput>
): Promise<WarrantyPlan | null> {
  try {
    const updateData: Record<string, unknown> = {};
    if (patch.providerName !== undefined) updateData.provider_name = patch.providerName.trim();
    if (patch.planName !== undefined) updateData.plan_name = patch.planName.trim();
    if (patch.coverageSummary !== undefined) {
      updateData.coverage_summary = patch.coverageSummary?.trim() ? patch.coverageSummary.trim() : null;
    }
    if (patch.durationMonths !== undefined) updateData.duration_months = patch.durationMonths;
    if (patch.priceUsd !== undefined) updateData.price_usd = patch.priceUsd;
    if (patch.currency !== undefined) updateData.currency = patch.currency?.trim() || 'USD';
    if (patch.deductibleUsd !== undefined) updateData.deductible_usd = patch.deductibleUsd;
    if (patch.productCategory !== undefined) {
      updateData.product_category = patch.productCategory?.trim() ? patch.productCategory.trim() : null;
    }
    if (patch.merchantId !== undefined) {
      updateData.merchant_id = patch.merchantId?.trim() ? patch.merchantId.trim() : null;
    }
    if (patch.sourceUrl !== undefined) {
      updateData.source_url = patch.sourceUrl?.trim() ? patch.sourceUrl.trim() : null;
    }
    if (patch.verifiedAt !== undefined) {
      updateData.verified_at = patch.verifiedAt?.trim() ? patch.verifiedAt.trim() : null;
    }
    if (patch.isActive !== undefined) updateData.is_active = patch.isActive;
    if (Object.keys(updateData).length === 0) return null;

    const { data, error } = await supabase
      .from('warranty_plans')
      .update(updateData)
      .eq('id', id)
      .select(
        'id, provider_name, plan_name, coverage_summary, duration_months, price_usd, currency, deductible_usd, product_category, merchant_id, source_url, verified_at, is_active, created_at'
      )
      .single();
    if (error || !data) {
      if (error && !isMissingTable(error)) {
        logger.warn('updateWarrantyPlan: update failed', { error: error.message });
      }
      return null;
    }
    return mapWarrantyPlanRow(data as Record<string, unknown>);
  } catch (err) {
    logger.error('updateWarrantyPlan: unexpected error', { error: String(err) });
    return null;
  }
}
