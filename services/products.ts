/**
 * Product data access service.
 * Reads from the `products`, `product_images`, `product_variants`,
 * `product_attributes`, and `product_tags` tables.
 *
 * All functions accept an `AnySupabaseClient` so they work with both the
 * browser (anon, RLS-enforced) and server (service role) clients.
 *
 * Database snake_case columns are mapped to camelCase TypeScript properties
 * in every return type.
 */

import type { AnySupabaseClient } from '@/lib/supabase/types';
import { swrGet, cacheKey } from '@/lib/cache';
import { logger } from '@/lib/config/logger';
import type { Product, ProductImage } from '@/types';
import type {
  ProductVariant,
  ProductAttribute,
  Category,
  Tag,
} from '@/types/catalog';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProductListOptions {
  page?: number;
  pageSize?: number;
  category?: string;
  brand?: string;
  search?: string;
}

export interface ProductListResult {
  products: Product[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

// ---------------------------------------------------------------------------
// Row → domain mappers
// ---------------------------------------------------------------------------

interface ProductRow {
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
}

function mapProduct(row: ProductRow): Product {
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
  };
}

interface ProductImageRow {
  id: string;
  product_id: string;
  url: string;
  alt_text: string | null;
  is_primary: boolean;
  sort_order: number;
}

function mapProductImage(row: ProductImageRow): ProductImage {
  return {
    id: row.id,
    productId: row.product_id,
    url: row.url,
    altText: row.alt_text,
    isPrimary: row.is_primary,
    sortOrder: row.sort_order,
  };
}

interface ProductVariantRow {
  id: string;
  product_id: string;
  name: string;
  sku: string | null;
  attributes: Record<string, unknown>;
  image_url: string | null;
  in_stock: boolean;
  sort_order: number;
  active: boolean;
}

function mapProductVariant(row: ProductVariantRow): ProductVariant {
  return {
    id: row.id,
    productId: row.product_id,
    name: row.name,
    sku: row.sku,
    attributes: row.attributes,
    imageUrl: row.image_url,
    inStock: row.in_stock,
    sortOrder: row.sort_order,
    active: row.active,
  };
}

interface ProductAttributeRow {
  id: string;
  product_id: string;
  key: string;
  value: string;
  unit: string | null;
  group: string | null;
  sort_order: number;
}

function mapProductAttribute(row: ProductAttributeRow): ProductAttribute {
  return {
    id: row.id,
    productId: row.product_id,
    key: row.key,
    value: row.value,
    unit: row.unit,
    group: row.group,
    sortOrder: row.sort_order,
  };
}

interface TagRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
}

function mapTag(row: TagRow): Tag {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
  };
}

// ---------------------------------------------------------------------------
// Product list (paginated, filterable)
// ---------------------------------------------------------------------------

/**
 * Fetch a paginated, filterable list of products.
 *
 * Supports search (ilike on name), category filter, and brand filter.
 * Only non-soft-deleted products are returned.
 */
export async function getProducts(
  supabase: AnySupabaseClient,
  options: ProductListOptions = {}
): Promise<ProductListResult> {
  const page = Math.max(1, options.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, options.pageSize ?? 20));
  const offset = (page - 1) * pageSize;

  try {
    let query = supabase
      .from('products')
      .select('id, name, slug, description, brand, category, image_url, gtin, confidence_score, data_freshness, created_at, updated_at', {
        count: 'exact',
      })
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .range(offset, offset + pageSize - 1);

    if (options.search) {
      // Search name, description, brand and category — not just name — so
      // a term like "laptop" finds the laptop products instead of nothing.
      const term = options.search.replace(/[%_,]/g, '');
      query = query.or(
        `name.ilike.%${term}%,description.ilike.%${term}%,brand.ilike.%${term}%,category.ilike.%${term}%`
      );
    }
    if (options.category) {
      query = query.eq('category', options.category);
    }
    if (options.brand) {
      query = query.eq('brand', options.brand);
    }

    const { data, error, count } = await query;

    if (error) {
      logger.warn('getProducts: query failed', { error: error.message });
      return { products: [], total: 0, page, pageSize, totalPages: 0 };
    }

    const products = (data ?? []).map(mapProduct);
    const total = count ?? 0;
    const totalPages = Math.ceil(total / pageSize);

    return { products, total, page, pageSize, totalPages };
  } catch (err) {
    logger.error('getProducts: unexpected error', { error: String(err) });
    return { products: [], total: 0, page, pageSize, totalPages: 0 };
  }
}

// ---------------------------------------------------------------------------
// Single product lookups
// ---------------------------------------------------------------------------

/**
 * Fetch a single product by ID.
 * Returns `null` if not found or on error.
 */
export async function getProductById(
  supabase: AnySupabaseClient,
  id: string
): Promise<Product | null> {
  try {
    const { data, error } = await supabase
      .from('products')
      .select('id, name, slug, description, brand, category, image_url, gtin, confidence_score, data_freshness, created_at, updated_at')
      .eq('id', id)
      .is('deleted_at', null)
      .maybeSingle();

    if (error || !data) {
      if (error) logger.warn('getProductById: query failed', { error: error.message });
      return null;
    }

    return mapProduct(data as ProductRow);
  } catch (err) {
    logger.error('getProductById: unexpected error', { error: String(err) });
    return null;
  }
}

/**
 * Fetch a single product by slug.
 * Returns `null` if not found or on error.
 */
export async function getProductBySlug(
  supabase: AnySupabaseClient,
  slug: string
): Promise<Product | null> {
  try {
    const { data, error } = await supabase
      .from('products')
      .select('id, name, slug, description, brand, category, image_url, gtin, confidence_score, data_freshness, created_at, updated_at')
      .eq('slug', slug)
      .is('deleted_at', null)
      .maybeSingle();

    if (error || !data) {
      if (error) logger.warn('getProductBySlug: query failed', { error: error.message });
      return null;
    }

    return mapProduct(data as ProductRow);
  } catch (err) {
    logger.error('getProductBySlug: unexpected error', { error: String(err) });
    return null;
  }
}

/**
 * Fetch a product by slug with Stale-While-Revalidate caching.
 * Uses `swrGet` from `@/lib/cache` with `cacheKey('product', slug)`.
 */
export async function getCachedProductBySlug(
  supabase: AnySupabaseClient,
  slug: string
): Promise<Product | null> {
  const key = cacheKey('product', slug);
  return swrGet<Product | null>(
    key,
    () => getProductBySlug(supabase, slug),
    60_000, // 1 min fresh
    300_000 // 5 min stale
  );
}

// ---------------------------------------------------------------------------
// Product relations
// ---------------------------------------------------------------------------

/**
 * Fetch images for a product.
 * Returns an array of `{ id, url, altText, isPrimary }` ordered by sort order.
 */
export async function getProductImages(
  supabase: AnySupabaseClient,
  productId: string
): Promise<{ id: string; url: string; altText: string | null; isPrimary: boolean }[]> {
  try {
    const { data, error } = await supabase
      .from('product_images')
      .select('id, url, alt_text, is_primary')
      .eq('product_id', productId)
      .order('sort_order', { ascending: true });

    if (error || !data) {
      if (error) logger.warn('getProductImages: query failed', { error: error.message });
      return [];
    }

    return data.map((row) => ({
      id: row.id,
      url: row.url,
      altText: row.alt_text,
      isPrimary: row.is_primary,
    }));
  } catch (err) {
    logger.error('getProductImages: unexpected error', { error: String(err) });
    return [];
  }
}

/**
 * Fetch active (non-deleted) product variants.
 */
export async function getProductVariants(
  supabase: AnySupabaseClient,
  productId: string
): Promise<ProductVariant[]> {
  try {
    const { data, error } = await supabase
      .from('product_variants')
      .select('id, product_id, name, sku, attributes, image_url, in_stock, sort_order, active')
      .eq('product_id', productId)
      .eq('active', true)
      .is('deleted_at', null)
      .order('sort_order', { ascending: true });

    if (error || !data) {
      if (error) logger.warn('getProductVariants: query failed', { error: error.message });
      return [];
    }

    return data.map((row) => mapProductVariant(row as ProductVariantRow));
  } catch (err) {
    logger.error('getProductVariants: unexpected error', { error: String(err) });
    return [];
  }
}

/**
 * Fetch structured product attributes (EAV-style specs).
 */
export async function getProductAttributes(
  supabase: AnySupabaseClient,
  productId: string
): Promise<ProductAttribute[]> {
  try {
    const { data, error } = await supabase
      .from('product_attributes')
      .select('id, product_id, key, value, unit, group, sort_order')
      .eq('product_id', productId)
      .order('sort_order', { ascending: true });

    if (error || !data) {
      if (error) logger.warn('getProductAttributes: query failed', { error: error.message });
      return [];
    }

    return data.map((row) => mapProductAttribute(row as ProductAttributeRow));
  } catch (err) {
    logger.error('getProductAttributes: unexpected error', { error: String(err) });
    return [];
  }
}

/**
 * Fetch tags associated with a product via the `product_tags` join table.
 */
export async function getProductTags(
  supabase: AnySupabaseClient,
  productId: string
): Promise<Tag[]> {
  try {
    const { data, error } = await supabase
      .from('product_tags')
      .select(
        'tags(id, name, slug, description)'
      )
      .eq('product_id', productId);

    if (error || !data) {
      if (error) logger.warn('getProductTags: query failed', { error: error.message });
      return [];
    }

    const tags: Tag[] = [];
    for (const row of data) {
      const tagRow = (row as { tags: TagRow | TagRow[] | null }).tags;
      if (Array.isArray(tagRow)) {
        for (const t of tagRow) tags.push(mapTag(t));
      } else if (tagRow) {
        tags.push(mapTag(tagRow));
      }
    }
    return tags;
  } catch (err) {
    logger.error('getProductTags: unexpected error', { error: String(err) });
    return [];
  }
}

// ---------------------------------------------------------------------------
// Facets: categories & brands (derived from the products table)
// ---------------------------------------------------------------------------

/**
 * Return distinct top-level category names from the `products` table.
 * These are the legacy text-based `category` column values (not the
 * `categories` reference table — see `services/catalog.ts` for that).
 */
export async function getCategories(
  supabase: AnySupabaseClient
): Promise<string[]> {
  try {
    const { data, error } = await supabase
      .from('products')
      .select('category')
      .not('category', 'is', null)
      .is('deleted_at', null);

    if (error || !data) {
      if (error) logger.warn('getCategories: query failed', { error: error.message });
      return [];
    }

    const categories = new Set<string>();
    for (const row of data) {
      if (row.category) categories.add(row.category);
    }
    return Array.from(categories).sort();
  } catch (err) {
    logger.error('getCategories: unexpected error', { error: String(err) });
    return [];
  }
}

/**
 * Return distinct brand names from the `products` table.
 * These are the legacy text-based `brand` column values (not the
 * `brands` reference table — see `services/catalog.ts` for that).
 */
export async function getBrands(
  supabase: AnySupabaseClient
): Promise<string[]> {
  try {
    const { data, error } = await supabase
      .from('products')
      .select('brand')
      .not('brand', 'is', null)
      .is('deleted_at', null);

    if (error || !data) {
      if (error) logger.warn('getBrands: query failed', { error: error.message });
      return [];
    }

    const brands = new Set<string>();
    for (const row of data) {
      if (row.brand) brands.add(row.brand);
    }
    return Array.from(brands).sort();
  } catch (err) {
    logger.error('getBrands: unexpected error', { error: String(err) });
    return [];
  }
}

// ---------------------------------------------------------------------------
// View count
// ---------------------------------------------------------------------------

/**
 * Increment the `view_count` column for a product (popularity signal).
 * Failures are logged but do not throw.
 */
export async function incrementViewCount(
  supabase: AnySupabaseClient,
  productId: string
): Promise<void> {
  try {
    // Use an RPC-free increment via raw update — Supabase JS doesn't support
    // atomic increments directly, so we read-then-write. For high-traffic
    // scenarios this should be replaced with a Postgres RPC (e.g. `rpc('increment_view_count')`).
    const { data, error } = await supabase
      .from('products')
      .select('view_count')
      .eq('id', productId)
      .maybeSingle();

    if (error || !data) {
      if (error) logger.warn('incrementViewCount: read failed', { error: error.message });
      return;
    }

    const next = (data.view_count ?? 0) + 1;
    const { error: updateError } = await supabase
      .from('products')
      .update({ view_count: next })
      .eq('id', productId);

    if (updateError) {
      logger.warn('incrementViewCount: update failed', { error: updateError.message });
    }
  } catch (err) {
    logger.error('incrementViewCount: unexpected error', { error: String(err) });
  }
}

// Re-export Category type for convenience (used by catalog service consumers)
export type { Category };
