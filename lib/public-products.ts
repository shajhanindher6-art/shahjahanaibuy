/**
 * Public product reads (Section 18, item 16; audit §1 #15).
 *
 * The central public path (services/products.ts) filters
 * `deleted_at IS NULL` + `status = 'published'`, but two public
 * routes read `products` directly and did not: `extension/price`
 * (resolves one product by slug/name) and `gifts` (lists up to
 * 100 products). If migration 010's RLS is unapplied live, a
 * soft-deleted (or pending) row could leak through those routes.
 *
 * These helpers apply the same public-product filter at the query
 * level so the defence does not depend on RLS alone:
 *   * `deleted_at IS NULL` — always.
 *   * `status = 'published'` — only when the live table has the
 *     column (migration 045). When 045 is unapplied, PostgREST
 *     answers 42703 (undefined_column) and the query is retried
 *     once without the status filter — pre-migration rows were
 *     already public, so they read as published (the same retry
 *     pattern services/products.ts uses). Never a throw, never an
 *     empty catalog, over an unapplied migration.
 *
 * The health-check row ('sample-laptop') is excluded here too,
 * matching every other public caller.
 */

import type { AnySupabaseClient } from '@/lib/supabase/types';

/**
 * Slugs excluded from every public product query (Stage 2, S2-1).
 *
 * The single entry today is the 'sample-laptop' database
 * health-check row — a real row that must NEVER be deleted, only
 * never shown as a product. Every inline `.neq('slug',
 * 'sample-laptop')` / `slug !== 'sample-laptop'` site in the repo
 * routes through this list (or `isExcludedSlug` below) so the
 * exclusion lives in exactly one place. The per-feature aliases
 * (BUNDLE_EXCLUDED_SLUGS, GIFT_EXCLUDED_SLUGS, …) are the same
 * list, not copies of it.
 */
export const EXCLUDED_SLUGS: readonly string[] = ['sample-laptop'];

/** True when a slug is one of the excluded health-check slugs. */
export function isExcludedSlug(slug: string | null | undefined): boolean {
  if (!slug) return false;
  return (EXCLUDED_SLUGS as readonly string[]).includes(slug);
}

/** PostgREST/Postgres code for "column does not exist". */
function isUndefinedColumnError(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === '42703';
}

export interface PublicProductRef {
  id: string;
  name: string;
  slug: string;
  /**
   * Final 100% — F-P2-21: recorded `products.data_freshness`, so
   * machine consumers (extension price endpoint) can label the
   * price's staleness instead of receiving a bare number. Null
   * when the row carries no check date. The column exists since
   * migration 002, so it rides the same select (unlike the 045
   * verification columns, which must never be selected here —
   * they would 42703 on a pre-045 table and break the lookup).
   */
  dataFreshness?: string | null;
}

export interface PublicProductRow extends PublicProductRef {
  brand: string | null;
  category: string | null;
  description: string | null;
}

const PUBLISHED_PRODUCT_STATUS = 'published';

type ProductQueryResult<T> = {
  data: T | null;
  error: { code?: string; message: string } | null;
};

/**
 * Run a products query with the published-status filter, retrying
 * once without it on 42703 (migration 045 unapplied). Any other
 * error returns null data — the caller renders an honest empty
 * state, never a throw.
 */
async function runPublicQuery<T>(
  run: (withStatus: boolean) => Promise<ProductQueryResult<T>>
): Promise<T | null> {
  const first = await run(true);
  if (!first.error) return first.data;
  if (isUndefinedColumnError(first.error)) {
    const retry = await run(false);
    if (!retry.error) return retry.data;
  }
  return null;
}

/** Resolve one public product by exact slug. */
export async function findPublicProductBySlug(
  supabase: AnySupabaseClient,
  slug: string
): Promise<PublicProductRef | null> {
  const row = await runPublicQuery<PublicProductRef & { data_freshness?: string | null }>(async (withStatus) => {
    let query = supabase
      .from('products')
      .select('id, name, slug, data_freshness')
      .eq('slug', slug)
      .neq('slug', EXCLUDED_SLUGS[0])
      .is('deleted_at', null);
    if (withStatus) query = query.eq('status', PUBLISHED_PRODUCT_STATUS);
    const { data, error } = await query.limit(1).maybeSingle();
    return { data: data as (PublicProductRef & { data_freshness?: string | null }) | null, error: error as ProductQueryResult<PublicProductRef>['error'] };
  });
  if (!row) return null;
  // The DB row carries snake_case data_freshness; map it to the
  // camelCase ref field (F-P2-21 fix — reading row.dataFreshness
  // directly would always be undefined).
  return { id: row.id, name: row.name, slug: row.slug, dataFreshness: row.data_freshness ?? null };
}

/** Resolve one public product by name match. */
export async function findPublicProductByName(
  supabase: AnySupabaseClient,
  q: string
): Promise<PublicProductRef | null> {
  const row = await runPublicQuery<PublicProductRef & { data_freshness?: string | null }>(async (withStatus) => {
    let query = supabase
      .from('products')
      .select('id, name, slug, data_freshness')
      .ilike('name', `%${q}%`)
      .neq('slug', EXCLUDED_SLUGS[0])
      .is('deleted_at', null);
    if (withStatus) query = query.eq('status', PUBLISHED_PRODUCT_STATUS);
    const { data, error } = await query.limit(1).maybeSingle();
    return { data: data as (PublicProductRef & { data_freshness?: string | null }) | null, error: error as ProductQueryResult<PublicProductRef>['error'] };
  });
  if (!row) return null;
  return { id: row.id, name: row.name, slug: row.slug, dataFreshness: row.data_freshness ?? null };
}

/** List public products for read-only pickers (gifts). */
export async function listPublicProducts(
  supabase: AnySupabaseClient,
  limit = 100
): Promise<PublicProductRow[]> {
  const rows = await runPublicQuery<PublicProductRow[]>(async (withStatus) => {
    let query = supabase
      .from('products')
      .select('id, name, slug, brand, category, description')
      .neq('slug', EXCLUDED_SLUGS[0])
      .is('deleted_at', null);
    if (withStatus) query = query.eq('status', PUBLISHED_PRODUCT_STATUS);
    const { data, error } = await query.limit(limit);
    return { data: data as PublicProductRow[] | null, error: error as ProductQueryResult<PublicProductRow[]>['error'] };
  });
  return rows ?? [];
}
