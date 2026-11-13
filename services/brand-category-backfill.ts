/**
 * FINAL 100% — brand/category linking backfill (F-P2-10, code half).
 *
 * Live truth: `brand_id` / `category_id` are NULL on all 10
 * products and the `categories` table is empty live, while the
 * text `brand` / `category` columns are populated. The linking
 * columns exist in the schema; the backfill that would populate
 * them depends on migration 071 (written by another worker,
 * owner-applied — it creates the rows the links point at).
 *
 * This module is the code half, behind that migration:
 * - `planBrandCategoryLinks` — read-only plan: for every product
 *   with a null `brand_id` or `category_id`, match its text
 *   brand/category against the `brands` / `categories` tables by
 *   normalized name (exact normalized match only — a fuzzy match
 *   would link a product to the wrong brand). Unmatched text is
 *   reported as "no row to link to", never auto-created: creating
 *   brand/category rows is the migration's job, not a backfill's.
 * - `applyBrandCategoryLinks` — applies a plan. `dryRun: true`
 *   (the default) changes nothing and reports what WOULD change.
 *   A real apply updates only the ids the plan matched, one
 *   product at a time, and reports per-product failures instead
 *   of failing the batch.
 *
 * Nothing here invents a brand or a category, and nothing links
 * on a guess: an unmatched product stays unlinked with its
 * reason recorded.
 */

import type { AnySupabaseClient } from '@/lib/supabase/types';
import { logger } from '@/lib/config/logger';

export interface BrandCategoryLinkPlanRow {
  productId: string;
  slug: string;
  brandText: string | null;
  categoryText: string | null;
  brandId: string | null;
  categoryId: string | null;
  /** Why a link could not be made (null when both linked). */
  reason: string | null;
  /** True when at least one id would change. */
  wouldChange: boolean;
}

export interface BrandCategoryLinkPlan {
  rows: BrandCategoryLinkPlanRow[];
  checked: number;
  linkable: number;
  unlinked: number;
  error?: string;
}

/** Lower-case, collapse non-alphanumerics — the same rule intake uses. */
export function normalizeLinkKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

/**
 * Build the backfill plan. Read-only. Never throws — a read
 * failure is reported in `error` and the plan comes back empty.
 */
export async function planBrandCategoryLinks(
  supabase: AnySupabaseClient,
  limit = 5000
): Promise<BrandCategoryLinkPlan> {
  try {
    const [productsRes, brandsRes, categoriesRes] = await Promise.all([
      supabase.from('products').select('id, slug, brand, category, brand_id, category_id').limit(limit),
      supabase.from('brands').select('id, name').limit(limit),
      supabase.from('categories').select('id, name').limit(limit),
    ]);
    if (productsRes.error) {
      return { rows: [], checked: 0, linkable: 0, unlinked: 0, error: productsRes.error.message };
    }
    const brandByKey = new Map<string, string>();
    for (const b of (brandsRes.data ?? []) as Array<{ id: string; name: string | null }>) {
      if (b.name) brandByKey.set(normalizeLinkKey(b.name), b.id);
    }
    const categoryByKey = new Map<string, string>();
    for (const c of (categoriesRes.data ?? []) as Array<{ id: string; name: string | null }>) {
      if (c.name) categoryByKey.set(normalizeLinkKey(c.name), c.id);
    }
    const rows: BrandCategoryLinkPlanRow[] = [];
    for (const p of (productsRes.data ?? []) as Array<{
      id: string;
      slug: string;
      brand: string | null;
      category: string | null;
      brand_id: string | null;
      category_id: string | null;
    }>) {
      if (p.brand_id && p.category_id) continue;
      const brandId = p.brand_id ?? (p.brand ? brandByKey.get(normalizeLinkKey(p.brand)) ?? null : null);
      const categoryId =
        p.category_id ?? (p.category ? categoryByKey.get(normalizeLinkKey(p.category)) ?? null : null);
      const gaps: string[] = [];
      if (!brandId && p.brand) gaps.push(`no brands row matches "${p.brand}"`);
      if (!categoryId && p.category) gaps.push(`no categories row matches "${p.category}"`);
      const wouldChange = (brandId !== null && !p.brand_id) || (categoryId !== null && !p.category_id);
      rows.push({
        productId: p.id,
        slug: p.slug,
        brandText: p.brand,
        categoryText: p.category,
        brandId,
        categoryId,
        reason: gaps.length > 0 ? gaps.join('; ') : null,
        wouldChange,
      });
    }
    return {
      rows,
      checked: (productsRes.data ?? []).length,
      linkable: rows.filter((r) => r.wouldChange).length,
      unlinked: rows.filter((r) => r.reason !== null).length,
    };
  } catch (err) {
    return { rows: [], checked: 0, linkable: 0, unlinked: 0, error: String(err) };
  }
}

export interface ApplyBrandCategoryLinksResult {
  updated: number;
  skipped: number;
  failures: Array<{ productId: string; reason: string }>;
  /** True when nothing was written (dry run). */
  dryRun: boolean;
}

/**
 * Apply a plan. Dry-run by default — pass `{ dryRun: false }`
 * to write. Only rows with a matched id AND a null stored id
 * are updated; failures are per-product and reported, never
 * fatal to the batch.
 */
export async function applyBrandCategoryLinks(
  supabase: AnySupabaseClient,
  plan: BrandCategoryLinkPlan,
  options: { dryRun?: boolean } = {}
): Promise<ApplyBrandCategoryLinksResult> {
  const dryRun = options.dryRun !== false;
  const result: ApplyBrandCategoryLinksResult = { updated: 0, skipped: 0, failures: [], dryRun };
  for (const row of plan.rows) {
    if (!row.wouldChange) {
      result.skipped += 1;
      continue;
    }
    if (dryRun) {
      result.updated += 1;
      continue;
    }
    const patch: Record<string, string> = {};
    if (row.brandId) patch.brand_id = row.brandId;
    if (row.categoryId) patch.category_id = row.categoryId;
    try {
      const { error } = (await supabase.from('products').update(patch).eq('id', row.productId)) as {
        error: { message: string } | null;
      };
      if (error) {
        result.failures.push({ productId: row.productId, reason: error.message });
      } else {
        result.updated += 1;
      }
    } catch (err) {
      logger.warn('brand-category backfill: update failed', { productId: row.productId });
      result.failures.push({ productId: row.productId, reason: String(err) });
    }
  }
  return result;
}
