/**
 * Section 20, §12 #69/#70 — admin catalog data access.
 *
 * The read/write side for /admin/products (list / edit / delete)
 * and /admin/products/review (duplicate candidates, missing specs,
 * image status, price history). All functions take the service-role
 * client — the pages run under /admin/layout.tsx (server-side admin
 * guard) and the API routes under requireAdmin, so there is no
 * second auth check here; this module does no auth of its own.
 *
 * Differences from the public reader (services/products.ts):
 * - NO published-only filter: pending / rejected rows are visible
 *   to admins (that is the point of the review queues).
 * - NO sample-laptop exclusion: the health-check row is a real row
 *   and an admin should see it.
 * - Writes exist: PATCH (validated field list) and DELETE, which
 *   is a SOFT delete (deleted_at) — catalog rows are never hard
 *   deleted, so a mistaken delete is reversible from the database.
 * - Same 42703 retry as the public reader: while migration 045 is
 *   unapplied the status / price_verification_status columns do
 *   not exist; the list/get fall back to the legacy column list
 *   and report `columnsMissing: true` instead of failing.
 *
 * Duplicate candidates (§12 #70): the review view calls
 * `listDuplicateCandidates` here, which FIRST tries
 * `findDuplicateCandidates` from services/pipeline/deduplication.ts
 * — a pure sweep over the product list (GTIN → exact name+brand →
 * fuzzy name within brand, §12 #9) — and falls back to the
 * in-service scan below when that helper cannot run. The `source`
 * field in the result says which path ran, so the page — and this
 * report — can state the dependency honestly.
 */

import type { AnySupabaseClient } from '@/lib/supabase/types';
import { logger } from '@/lib/config/logger';
import {
  normalizePriceVerificationStatus,
  normalizeProductStatus,
  PRODUCT_STATUSES,
  type PriceVerificationStatus,
  type ProductStatus,
} from './price-verification';
import { isValidImageUrl, type QualityScoreContext } from './product-quality-score';
import type {
  DuplicateCandidate as SweepCandidate,
  DuplicateSweepProduct,
} from './pipeline/deduplication';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AdminProduct {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  brand: string | null;
  category: string | null;
  imageUrl: string | null;
  gtin: string | null;
  confidenceScore: number;
  dataFreshness: string;
  createdAt: string;
  updatedAt: string;
  status: ProductStatus;
  priceVerificationStatus: PriceVerificationStatus;
  priceVerifiedAt: string | null;
}

interface AdminProductRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  brand: string | null;
  category: string | null;
  image_url: string | null;
  gtin: string | null;
  confidence_score: number;
  data_freshness: string;
  created_at: string;
  updated_at: string;
  status?: string | null;
  price_verification_status?: string | null;
  price_verified_at?: string | null;
}

const ADMIN_PRODUCT_COLUMNS =
  'id, name, slug, description, brand, category, image_url, gtin, confidence_score, data_freshness, created_at, updated_at, status, price_verification_status, price_verified_at';
const ADMIN_PRODUCT_COLUMNS_LEGACY =
  'id, name, slug, description, brand, category, image_url, gtin, confidence_score, data_freshness, created_at, updated_at';

function isUndefinedColumnError(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === '42703';
}

function mapAdminProduct(row: AdminProductRow): AdminProduct {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    brand: row.brand,
    category: row.category,
    imageUrl: row.image_url,
    gtin: row.gtin,
    confidenceScore: row.confidence_score,
    dataFreshness: row.data_freshness,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    status: normalizeProductStatus(row.status),
    priceVerificationStatus: normalizePriceVerificationStatus(row.price_verification_status),
    priceVerifiedAt: row.price_verified_at ?? null,
  };
}

// ---------------------------------------------------------------------------
// List / get
// ---------------------------------------------------------------------------

export interface ListAdminProductsOptions {
  search?: string;
  status?: string;
  verification?: string;
  page?: number;
  pageSize?: number;
}

export interface ListAdminProductsResult {
  products: AdminProduct[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  /** True when the 045 columns are missing and the legacy list ran. */
  columnsMissing: boolean;
  error?: string;
}

export async function listAdminProducts(
  supabase: AnySupabaseClient,
  options: ListAdminProductsOptions = {}
): Promise<ListAdminProductsResult> {
  const page = Math.max(1, options.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, options.pageSize ?? 20));
  const offset = (page - 1) * pageSize;
  const search = (options.search ?? '').trim();
  const statusFilter =
    options.status && (PRODUCT_STATUSES as readonly string[]).includes(options.status)
      ? (options.status as ProductStatus)
      : null;
  const verificationFilter =
    options.verification &&
    ['verified', 'unverified', 'stale'].includes(options.verification)
      ? (options.verification as PriceVerificationStatus)
      : null;

  const runQuery = async (withNewColumns: boolean) => {
    const columns: string = withNewColumns ? ADMIN_PRODUCT_COLUMNS : ADMIN_PRODUCT_COLUMNS_LEGACY;
    let query = supabase
      .from('products')
      .select(columns, { count: 'exact' })
      .is('deleted_at', null);
    if (withNewColumns && statusFilter) query = query.eq('status', statusFilter);
    if (withNewColumns && verificationFilter) {
      query = query.eq('price_verification_status', verificationFilter);
    }
    if (search) {
      const term = search.replace(/[%_,]/g, '');
      query = query.or(
        `name.ilike.%${term}%,description.ilike.%${term}%,brand.ilike.%${term}%,category.ilike.%${term}%`
      );
    }
    const { data, error, count } = (await query
      .order('created_at', { ascending: false })
      .range(offset, offset + pageSize - 1)) as unknown as {
      data: AdminProductRow[] | null;
      error: { code?: string; message: string } | null;
      count: number | null;
    };
    return { data, error, count };
  };

  try {
    let { data, error, count } = await runQuery(true);
    let columnsMissing = false;
    if (error && isUndefinedColumnError(error)) {
      columnsMissing = true;
      ({ data, error, count } = await runQuery(false));
    }
    if (error) {
      logger.warn('listAdminProducts: query failed', { error: error.message });
      return {
        products: [],
        total: 0,
        page,
        pageSize,
        totalPages: 0,
        columnsMissing,
        error: error.message,
      };
    }
    const total = count ?? 0;
    return {
      products: (data ?? []).map(mapAdminProduct),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
      columnsMissing,
    };
  } catch (err) {
    logger.error('listAdminProducts: unexpected error', { error: String(err) });
    return {
      products: [],
      total: 0,
      page,
      pageSize,
      totalPages: 0,
      columnsMissing: false,
      error: String(err),
    };
  }
}

export interface GetAdminProductResult {
  product: AdminProduct | null;
  /** True when the 045 columns are missing (legacy read ran). */
  columnsMissing: boolean;
}

export async function getAdminProductById(
  supabase: AnySupabaseClient,
  id: string
): Promise<GetAdminProductResult> {
  const runQuery = async (withNewColumns: boolean) => {
    const columns: string = withNewColumns ? ADMIN_PRODUCT_COLUMNS : ADMIN_PRODUCT_COLUMNS_LEGACY;
    return (await supabase
      .from('products')
      .select(columns)
      .eq('id', id)
      .is('deleted_at', null)
      .maybeSingle()) as unknown as {
      data: AdminProductRow | null;
      error: { code?: string; message: string } | null;
    };
  };
  try {
    let { data, error } = await runQuery(true);
    let columnsMissing = false;
    if (error && isUndefinedColumnError(error)) {
      columnsMissing = true;
      ({ data, error } = await runQuery(false));
    }
    if (error || !data) {
      if (error) logger.warn('getAdminProductById: query failed', { error: error.message });
      return { product: null, columnsMissing };
    }
    return { product: mapAdminProduct(data), columnsMissing };
  } catch (err) {
    logger.error('getAdminProductById: unexpected error', { error: String(err) });
    return { product: null, columnsMissing: false };
  }
}

// ---------------------------------------------------------------------------
// Update / delete
// ---------------------------------------------------------------------------

export interface AdminProductPatch {
  name?: string | null;
  description?: string | null;
  brand?: string | null;
  category?: string | null;
  image_url?: string | null;
  gtin?: string | null;
  status?: string | null;
}

const PATCHABLE_FIELDS = ['name', 'description', 'brand', 'category', 'image_url', 'gtin', 'status'] as const;

/**
 * Pure validation for an admin product patch. Returns the cleaned
 * DB patch, or an error message. Rules:
 * - unknown fields are rejected (never silently stored);
 * - name must be non-empty when given; strings are length-capped;
 * - image_url must be a valid http(s) URL when given — `data:` /
 *   `javascript:` / relative URLs are rejected (audit §1 #10:
 *   image_url is rendered raw in <img> on public pages);
 * - gtin is length-checked only here — format/check-digit
 *   validation is audit §12 #31 (another worker's item);
 * - status must be a migration 045 value; the column itself may
 *   not exist yet, which the update reports separately.
 */
export function validateAdminProductPatch(
  body: Record<string, unknown>
): { patch: AdminProductPatch; error?: undefined } | { patch: null; error: string } {
  const patch: AdminProductPatch = {};
  for (const key of Object.keys(body)) {
    if (!(PATCHABLE_FIELDS as readonly string[]).includes(key)) {
      return { patch: null, error: `Field "${key}" cannot be edited here.` };
    }
  }
  const asText = (key: string, max: number): { value: string | null; error?: string } => {
    const raw = body[key];
    if (raw === undefined) return { value: null };
    if (raw === null) return { value: null };
    if (typeof raw !== 'string') return { value: null, error: `"${key}" must be a string or null.` };
    const trimmed = raw.trim();
    if (trimmed.length > max) {
      return { value: null, error: `"${key}" must be at most ${max} characters.` };
    }
    return { value: trimmed === '' ? null : trimmed };
  };
  if (body.name !== undefined) {
    const { value, error } = asText('name', 200);
    if (error) return { patch: null, error };
    if (value === null) return { patch: null, error: '"name" must not be empty.' };
    patch.name = value;
  }
  for (const key of ['description', 'brand', 'category'] as const) {
    if (body[key] !== undefined) {
      const { value, error } = asText(key, key === 'description' ? 5000 : 200);
      if (error) return { patch: null, error };
      patch[key] = value;
    }
  }
  if (body.image_url !== undefined) {
    const { value, error } = asText('image_url', 2048);
    if (error) return { patch: null, error };
    if (value !== null && !isValidImageUrl(value)) {
      return {
        patch: null,
        error: '"image_url" must be a valid http(s) URL.',
      };
    }
    patch.image_url = value;
  }
  if (body.gtin !== undefined) {
    const { value, error } = asText('gtin', 50);
    if (error) return { patch: null, error };
    patch.gtin = value;
  }
  if (body.status !== undefined) {
    const raw = body.status;
    if (raw === null) {
      return { patch: null, error: '"status" must not be null.' };
    }
    if (typeof raw !== 'string' || !(PRODUCT_STATUSES as readonly string[]).includes(raw)) {
      return {
        patch: null,
        error: `"status" must be one of: ${PRODUCT_STATUSES.join(', ')}.`,
      };
    }
    patch.status = raw as ProductStatus;
  }
  if (Object.keys(patch).length === 0) {
    return { patch: null, error: 'No editable field was provided.' };
  }
  return { patch };
}

export interface UpdateAdminProductResult {
  product: AdminProduct | null;
  error?: string;
}

export async function updateAdminProduct(
  supabase: AnySupabaseClient,
  id: string,
  patch: AdminProductPatch
): Promise<UpdateAdminProductResult> {
  try {
    const dbPatch: Record<string, unknown> = { ...patch, updated_at: new Date().toISOString() };
    const { data, error } = (await supabase
      .from('products')
      .update(dbPatch)
      .eq('id', id)
      .is('deleted_at', null)
      .select(ADMIN_PRODUCT_COLUMNS)
      .maybeSingle()) as unknown as {
      data: AdminProductRow | null;
      error: { code?: string; message: string } | null;
    };
    if (error) {
      if (isUndefinedColumnError(error)) {
        // The only 045 column an admin patch can touch is `status`;
        // a legacy row has no such column, so the whole update
        // fails on it. Report it plainly instead of a generic 500.
        return {
          product: null,
          error:
            patch.status !== undefined
              ? 'The status column does not exist yet — migration 045 has not been applied, so status cannot be changed.'
              : 'The product could not be updated (a column in this edit does not exist yet).',
        };
      }
      logger.warn('updateAdminProduct: update failed', { error: error.message });
      return { product: null, error: error.message };
    }
    if (!data) return { product: null, error: 'Product not found.' };
    return { product: mapAdminProduct(data) };
  } catch (err) {
    logger.error('updateAdminProduct: unexpected error', { error: String(err) });
    return { product: null, error: String(err) };
  }
}

export interface DeleteAdminProductResult {
  ok: boolean;
  error?: string;
}

/** Soft delete: sets deleted_at. Never hard-deletes a catalog row. */
export async function deleteAdminProduct(
  supabase: AnySupabaseClient,
  id: string
): Promise<DeleteAdminProductResult> {
  try {
    const { data, error } = (await supabase
      .from('products')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id)
      .is('deleted_at', null)
      .select('id')
      .maybeSingle()) as unknown as {
      data: { id: string } | null;
      error: { code?: string; message: string } | null;
    };
    if (error) {
      logger.warn('deleteAdminProduct: delete failed', { error: error.message });
      return { ok: false, error: error.message };
    }
    if (!data) return { ok: false, error: 'Product not found.' };
    return { ok: true };
  } catch (err) {
    logger.error('deleteAdminProduct: unexpected error', { error: String(err) });
    return { ok: false, error: String(err) };
  }
}

// ---------------------------------------------------------------------------
// Quality-score context for a set of products
// ---------------------------------------------------------------------------

/**
 * Read the context `computeProductQualityScore` needs for a set of
 * product ids: spec counts, merchant counts (cheapest listing's
 * source), and the newest price_history point. Any read that fails
 * yields an empty context for that dimension — the scorer then
 * counts it as missing, never as present.
 */
export async function getProductQualityContexts(
  supabase: AnySupabaseClient,
  productIds: string[]
): Promise<Map<string, QualityScoreContext>> {
  const contexts = new Map<string, QualityScoreContext>();
  for (const id of productIds) contexts.set(id, {});
  if (productIds.length === 0) return contexts;

  try {
    const { data: attrs } = await supabase
      .from('product_attributes')
      .select('product_id')
      .in('product_id', productIds)
      .limit(5000);
    for (const row of (attrs ?? []) as Array<{ product_id: string }>) {
      const ctx = contexts.get(row.product_id);
      if (ctx) ctx.specCount = (ctx.specCount ?? 0) + 1;
    }
  } catch {
    // Missing context scores 0 in its dimension — never a throw.
  }

  try {
    const { data: images } = await supabase
      .from('product_images')
      .select('product_id')
      .in('product_id', productIds)
      .limit(5000);
    for (const row of (images ?? []) as Array<{ product_id: string }>) {
      const ctx = contexts.get(row.product_id);
      if (ctx) ctx.imageCount = (ctx.imageCount ?? 0) + 1;
    }
  } catch {
    // As above.
  }

  try {
    const { data: merchants } = await supabase
      .from('merchant_products')
      .select('product_id, price, in_stock, price_source')
      .in('product_id', productIds)
      .is('deleted_at', null)
      .order('price', { ascending: true })
      .limit(5000);
    for (const row of (merchants ?? []) as Array<{
      product_id: string;
      in_stock: boolean;
      price_source?: string | null;
    }>) {
      const ctx = contexts.get(row.product_id);
      if (!ctx) continue;
      ctx.merchantCount = (ctx.merchantCount ?? 0) + 1;
      if (row.in_stock === true) ctx.inStockMerchantCount = (ctx.inStockMerchantCount ?? 0) + 1;
      // Rows arrive cheapest first, so the first row's source is
      // the cheapest listing's source.
      if (ctx.priceSource === undefined) ctx.priceSource = row.price_source ?? null;
    }
  } catch {
    // As above.
  }

  try {
    const { data: history } = await supabase
      .from('price_history')
      .select('product_id, recorded_at')
      .in('product_id', productIds)
      .order('recorded_at', { ascending: false })
      .limit(1000);
    for (const row of (history ?? []) as Array<{ product_id: string; recorded_at: string }>) {
      const ctx = contexts.get(row.product_id);
      if (ctx && ctx.lastPriceRecordedAt === undefined) {
        ctx.lastPriceRecordedAt = row.recorded_at;
      }
    }
  } catch {
    // As above.
  }

  return contexts;
}

// ---------------------------------------------------------------------------
// Review views (§12 #70)
// ---------------------------------------------------------------------------

export interface DuplicateCandidateProduct {
  id: string;
  name: string;
  slug: string;
  brand: string | null;
  gtin: string | null;
}

export interface DuplicateCandidate {
  productA: DuplicateCandidateProduct;
  productB: DuplicateCandidateProduct;
  matchedBy: 'gtin' | 'name-brand' | 'name-brand-fuzzy';
  detail: string;
}

export interface ListDuplicateCandidatesResult {
  candidates: DuplicateCandidate[];
  /** Which implementation produced the list (see header). */
  source: 'deduplication-service' | 'fallback-scan';
  error?: string;
}

function normalizeNameBrand(name: string, brand: string | null): string {
  return `${name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}|${(brand ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()}`;
}

function normalizeGtin(gtin: string | null): string | null {
  if (!gtin) return null;
  const digits = gtin.replace(/[\s-]/g, '');
  return digits === '' ? null : digits;
}

/**
 * Map the pipeline sweep's return shape onto the review shape.
 * The sweep returns `{ productId, duplicateOfProductId, matchedBy,
 * reasons }` pairs over the product list it was given; the review
 * view needs full rows for both sides, so both ids are looked up
 * in the list that was swept. A pair whose side is missing from
 * that list is dropped (never rendered half-empty). Returns null
 * when the value is not a sweep-shaped array at all, so the
 * caller falls back to the in-service scan.
 */
function mapSweepCandidates(
  value: unknown,
  rowsById: Map<string, DuplicateCandidateProduct>
): DuplicateCandidate[] | null {
  if (!Array.isArray(value)) return null;
  const out: DuplicateCandidate[] = [];
  for (const item of value as Array<Record<string, unknown>>) {
    const sweep = item as unknown as SweepCandidate | null;
    if (
      !sweep ||
      typeof sweep.productId !== 'string' ||
      typeof sweep.duplicateOfProductId !== 'string' ||
      !Array.isArray(sweep.reasons)
    ) {
      return null;
    }
    const productB = rowsById.get(sweep.productId);
    const productA = rowsById.get(sweep.duplicateOfProductId);
    if (!productA || !productB) continue;
    const matchedBy =
      sweep.matchedBy === 'gtin' || sweep.matchedBy === 'name-brand' || sweep.matchedBy === 'name-brand-fuzzy'
        ? sweep.matchedBy
        : 'name-brand';
    out.push({
      productA,
      productB,
      matchedBy,
      detail: sweep.reasons.join('; '),
    });
  }
  return out;
}

/** The in-service fallback scan (exact GTIN / exact normalized
 *  name+brand only — no fuzzy leg). Exported for tests: it is the
 *  backstop when the pipeline helper cannot run. */
export async function scanDuplicateCandidates(
  supabase: AnySupabaseClient,
  limit: number
): Promise<DuplicateCandidate[]> {
  const { data, error } = await supabase
    .from('products')
    .select('id, name, slug, brand, gtin')
    .is('deleted_at', null)
    .limit(500);
  if (error || !data) {
    if (error) logger.warn('scanDuplicateCandidates: query failed', { error: error.message });
    return [];
  }
  const rows = data as DuplicateCandidateProduct[];
  const candidates: DuplicateCandidate[] = [];
  const seen = new Set<string>();

  const byGtin = new Map<string, DuplicateCandidateProduct>();
  for (const row of rows) {
    const gtin = normalizeGtin(row.gtin);
    if (!gtin) continue;
    const existing = byGtin.get(gtin);
    if (existing) {
      const key = [existing.id, row.id].sort().join('|');
      if (!seen.has(key)) {
        seen.add(key);
        candidates.push({
          productA: existing,
          productB: row,
          matchedBy: 'gtin',
          detail: `Same GTIN ${gtin} on two products.`,
        });
      }
    } else {
      byGtin.set(gtin, row);
    }
  }

  const byNameBrand = new Map<string, DuplicateCandidateProduct>();
  for (const row of rows) {
    const key = normalizeNameBrand(row.name, row.brand);
    const existing = byNameBrand.get(key);
    if (existing && existing.id !== row.id) {
      const pairKey = [existing.id, row.id].sort().join('|');
      if (!seen.has(pairKey)) {
        seen.add(pairKey);
        candidates.push({
          productA: existing,
          productB: row,
          matchedBy: 'name-brand',
          detail: `Same normalized name and brand ("${row.name}" / ${row.brand ?? 'no brand'}).`,
        });
      }
    } else if (!existing) {
      byNameBrand.set(key, row);
    }
  }

  return candidates.slice(0, limit);
}

export async function listDuplicateCandidates(
  supabase: AnySupabaseClient,
  limit = 50
): Promise<ListDuplicateCandidatesResult> {
  // Prefer the pipeline helper (services/pipeline/deduplication.ts
  // §12 #9): it is a PURE sweep over a product list — call it with
  // the rows, never with the client. The dynamic import is
  // deliberate: if the module ever fails to load, the scan below
  // is the fallback instead of a failed review page. Any failure
  // in this branch (read, import, call, mapping) falls through to
  // that scan; only a successfully mapped sweep reports
  // 'deduplication-service'.
  try {
    const { data, error } = await supabase
      .from('products')
      .select('id, name, slug, brand, gtin')
      .is('deleted_at', null)
      .limit(500);
    if (!error && data) {
      const rows = data as DuplicateCandidateProduct[];
      const rowsById = new Map(rows.map((r) => [r.id, r]));
      const mod = (await import('./pipeline/deduplication')) as unknown as {
        findDuplicateCandidates?: unknown;
      };
      if (typeof mod.findDuplicateCandidates === 'function') {
        const out = (mod.findDuplicateCandidates as (products: DuplicateSweepProduct[]) => unknown)(
          rows
        );
        const mapped = mapSweepCandidates(out, rowsById);
        if (mapped) {
          return { candidates: mapped.slice(0, limit), source: 'deduplication-service' };
        }
      }
    } else if (error) {
      logger.warn('listDuplicateCandidates: products read failed, falling back to scan', {
        error: error.message,
      });
    }
  } catch {
    // Helper absent or unusable — the scan below is the fallback.
  }
  try {
    const candidates = await scanDuplicateCandidates(supabase, limit);
    return { candidates, source: 'fallback-scan' };
  } catch (err) {
    logger.error('listDuplicateCandidates: unexpected error', { error: String(err) });
    return { candidates: [], source: 'fallback-scan', error: String(err) };
  }
}

export interface MissingSpecsProduct {
  id: string;
  name: string;
  slug: string;
  brand: string | null;
  category: string | null;
}

export interface ListMissingSpecsResult {
  products: MissingSpecsProduct[];
  checked: number;
  error?: string;
}

/** Products with zero stored product_attributes rows. */
export async function listProductsMissingSpecs(
  supabase: AnySupabaseClient,
  limit = 50
): Promise<ListMissingSpecsResult> {
  try {
    const { data: products, error: productsError } = await supabase
      .from('products')
      .select('id, name, slug, brand, category')
      .is('deleted_at', null)
      .limit(500);
    if (productsError || !products) {
      return {
        products: [],
        checked: 0,
        error: productsError?.message ?? 'Products could not be read.',
      };
    }
    const { data: attrs } = await supabase
      .from('product_attributes')
      .select('product_id')
      .limit(5000);
    const withSpecs = new Set(
      ((attrs ?? []) as Array<{ product_id: string }>).map((r) => r.product_id)
    );
    const missing = (products as MissingSpecsProduct[]).filter((p) => !withSpecs.has(p.id));
    return { products: missing.slice(0, limit), checked: products.length };
  } catch (err) {
    return { products: [], checked: 0, error: String(err) };
  }
}

export interface ProductImageStatus {
  productId: string;
  name: string;
  slug: string;
  imageUrl: string | null;
  imageUrlValid: boolean;
  imageCount: number;
  status: 'ok' | 'missing-image' | 'invalid-image-url';
}

export interface ListProductImageStatusResult {
  rows: ProductImageStatus[];
  checked: number;
  error?: string;
}

/** Per-product image status: valid image_url + gallery rows. */
export async function listProductImageStatus(
  supabase: AnySupabaseClient,
  limit = 50
): Promise<ListProductImageStatusResult> {
  try {
    const { data: products, error: productsError } = await supabase
      .from('products')
      .select('id, name, slug, image_url')
      .is('deleted_at', null)
      .limit(500);
    if (productsError || !products) {
      return {
        rows: [],
        checked: 0,
        error: productsError?.message ?? 'Products could not be read.',
      };
    }
    const { data: images } = await supabase
      .from('product_images')
      .select('product_id')
      .limit(5000);
    const counts = new Map<string, number>();
    for (const row of (images ?? []) as Array<{ product_id: string }>) {
      counts.set(row.product_id, (counts.get(row.product_id) ?? 0) + 1);
    }
    const rows: ProductImageStatus[] = (
      products as Array<{ id: string; name: string; slug: string; image_url: string | null }>
    ).map((p) => {
      const valid = isValidImageUrl(p.image_url);
      return {
        productId: p.id,
        name: p.name,
        slug: p.slug,
        imageUrl: p.image_url,
        imageUrlValid: valid,
        imageCount: counts.get(p.id) ?? 0,
        status: !p.image_url
          ? 'missing-image'
          : valid
            ? 'ok'
            : 'invalid-image-url',
      };
    });
    return { rows: rows.slice(0, limit), checked: products.length };
  } catch (err) {
    return { rows: [], checked: 0, error: String(err) };
  }
}

export interface AdminPriceHistoryRow {
  id: string;
  productId: string;
  retailerId: string;
  retailerSlug: string | null;
  price: number;
  currency: string | null;
  availability: string | null;
  recordedAt: string;
}

export interface GetAdminProductPriceHistoryResult {
  rows: AdminPriceHistoryRow[];
  error?: string;
}

/** Newest price_history rows for one product, with retailer slugs. */
export async function getAdminProductPriceHistory(
  supabase: AnySupabaseClient,
  productId: string,
  limit = 50
): Promise<GetAdminProductPriceHistoryResult> {
  try {
    const { data, error } = await supabase
      .from('price_history')
      .select('id, product_id, retailer_id, price, currency, availability, recorded_at')
      .eq('product_id', productId)
      .order('recorded_at', { ascending: false })
      .limit(limit);
    if (error || !data) {
      return { rows: [], error: error?.message ?? 'Price history could not be read.' };
    }
    const { data: retailers } = await supabase.from('retailers').select('id, slug');
    const slugById = new Map(
      ((retailers ?? []) as Array<{ id: string; slug: string }>).map((r) => [r.id, r.slug])
    );
    return {
      rows: (data as Array<Record<string, unknown>>).map((r) => ({
        id: String(r.id),
        productId: String(r.product_id),
        retailerId: String(r.retailer_id),
        retailerSlug: slugById.get(String(r.retailer_id)) ?? null,
        price: Number(r.price),
        currency: (r.currency as string | null) ?? null,
        availability: (r.availability as string | null) ?? null,
        recordedAt: String(r.recorded_at),
      })),
    };
  } catch (err) {
    return { rows: [], error: String(err) };
  }
}

export interface ProductPriceHistorySummary {
  productId: string;
  name: string;
  slug: string;
  pointCount: number;
  latestRecordedAt: string | null;
}

export interface ListProductsPriceHistorySummaryResult {
  rows: ProductPriceHistorySummary[];
  error?: string;
}

/** One row per product: how many price_history points it has and
 *  when the newest was recorded. Products with no history show
 *  pointCount 0 and latestRecordedAt null — that IS the finding
 *  (no history), never an omitted row. */
export async function listProductsPriceHistorySummary(
  supabase: AnySupabaseClient,
  limit = 50
): Promise<ListProductsPriceHistorySummaryResult> {
  try {
    const { data: products, error: productsError } = await supabase
      .from('products')
      .select('id, name, slug')
      .is('deleted_at', null)
      .limit(500);
    if (productsError || !products) {
      return { rows: [], error: productsError?.message ?? 'Products could not be read.' };
    }
    const { data: history } = await supabase
      .from('price_history')
      .select('product_id, recorded_at')
      .order('recorded_at', { ascending: false })
      .limit(1000);
    const byProduct = new Map<string, { count: number; latest: string | null }>();
    for (const row of (history ?? []) as Array<{ product_id: string; recorded_at: string }>) {
      const entry = byProduct.get(row.product_id) ?? { count: 0, latest: null };
      entry.count += 1;
      if (entry.latest === null) entry.latest = row.recorded_at;
      byProduct.set(row.product_id, entry);
    }
    const rows: ProductPriceHistorySummary[] = (
      products as Array<{ id: string; name: string; slug: string }>
    )
      .map((p) => ({
        productId: p.id,
        name: p.name,
        slug: p.slug,
        pointCount: byProduct.get(p.id)?.count ?? 0,
        latestRecordedAt: byProduct.get(p.id)?.latest ?? null,
      }))
      .sort((a, b) => {
        if (a.latestRecordedAt === null && b.latestRecordedAt === null) return 0;
        if (a.latestRecordedAt === null) return 1;
        if (b.latestRecordedAt === null) return -1;
        return b.latestRecordedAt.localeCompare(a.latestRecordedAt);
      });
    return { rows: rows.slice(0, limit) };
  } catch (err) {
    return { rows: [], error: String(err) };
  }
}
