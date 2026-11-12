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
import { discountPercent } from '@/lib/deal-math';
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
  /**
   * Sort key. Default 'newest' (created_at desc, the historical
   * order). 'price' sorts by the lowest in-stock merchant_products
   * price; 'name' sorts by product name. There is deliberately NO
   * Deal Score sort: the score is 100/100 for every product today
   * (calculateDiscountProbability returns 0 with <5 price points),
   * so it would sort nothing.
   */
  sort?: 'newest' | 'price' | 'name';
  /** Sort direction. Default 'desc' for newest, 'asc' otherwise. */
  order?: 'asc' | 'desc';
}

/** Lowest in-stock merchant price for a product, plus how many
 *  merchants have it in stock (the "at N stores" count). Section
 *  16, #30: `compareAtPrice` is the cheapest row's recorded
 *  compare-at price (null when the row carries none) and
 *  `discountPercent` is that row's discountPercent(price,
 *  compareAtPrice) — null when there is no real saving. Both come
 *  from recorded merchant rows only. */
export interface LowestMerchantPrice {
  price: number;
  merchantCount: number;
  compareAtPrice?: number | null;
  discountPercent?: number | null;
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

/**
 * Lowest in-stock merchant price per product, batched over one
 * `merchant_products` query (ordered by price ascending, so the
 * first row per product is its cheapest in-stock listing).
 *
 * Only in-stock rows count: the price shown is a price the visitor
 * can actually buy at, and merchantCount counts only merchants
 * with the product in stock. A product with no in-stock listing
 * is absent from the map (never a guessed price).
 */
export async function getLowestMerchantPrices(
  supabase: AnySupabaseClient,
  productIds: string[]
): Promise<Map<string, LowestMerchantPrice>> {
  const prices = new Map<string, LowestMerchantPrice>();
  const ids = Array.from(new Set(productIds.filter(Boolean)));
  if (ids.length === 0) return prices;
  try {
    const { data, error } = await supabase
      .from('merchant_products')
      .select('product_id, merchant_id, price, compare_at_price')
      .in('product_id', ids)
      .is('deleted_at', null)
      .eq('in_stock', true)
      .order('price', { ascending: true });
    if (error || !data) {
      if (error) logger.warn('getLowestMerchantPrices: query failed', { error: error.message });
      return prices;
    }
    const merchantsByProduct = new Map<string, Set<string>>();
    for (const row of data as Array<{ product_id: string; merchant_id: string; price: number | string; compare_at_price?: number | string | null }>) {
      const price = parseFloat(String(row.price));
      if (!Number.isFinite(price)) continue;
      if (!prices.has(row.product_id)) {
        // Section 16, #30 — the first row is the cheapest (query
        // orders by price), so its compare-at price is the discount
        // basis for the lowest price shown.
        const compareAt =
          row.compare_at_price === null || row.compare_at_price === undefined
            ? null
            : parseFloat(String(row.compare_at_price));
        prices.set(row.product_id, {
          price,
          merchantCount: 0,
          compareAtPrice: Number.isFinite(compareAt as number) ? (compareAt as number) : null,
          discountPercent: discountPercent(
            price,
            Number.isFinite(compareAt as number) ? (compareAt as number) : null
          ),
        });
      }
      let merchants = merchantsByProduct.get(row.product_id);
      if (!merchants) {
        merchants = new Set<string>();
        merchantsByProduct.set(row.product_id, merchants);
      }
      if (row.merchant_id) merchants.add(row.merchant_id);
    }
    for (const [productId, merchants] of merchantsByProduct) {
      const entry = prices.get(productId);
      if (entry) entry.merchantCount = merchants.size;
    }
  } catch (err) {
    logger.error('getLowestMerchantPrices: unexpected error', { error: String(err) });
  }
  return prices;
}

// ---------------------------------------------------------------------------
// Product list (paginated, filterable)
// ---------------------------------------------------------------------------

/**
 * Fetch a paginated, filterable list of products.
 *
 * Supports search (ilike on name), category filter, and brand filter.
 * Only non-soft-deleted products are returned.
 *
 * Sorting: 'newest' (default) and 'name' order in SQL, so pagination
 * stays exact. 'price' sorts by the lowest in-stock merchant price,
 * which lives in `merchant_products`, not `products` — so the
 * filtered set is fetched first (at most 100 rows; the catalog is
 * 10 products), sorted in memory, then paged. Unpriced products
 * sort last in both directions: they have no price to rank by.
 */
export async function getProducts(
  supabase: AnySupabaseClient,
  options: ProductListOptions = {}
): Promise<ProductListResult> {
  const page = Math.max(1, options.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, options.pageSize ?? 20));
  const offset = (page - 1) * pageSize;
  const sort = options.sort ?? 'newest';
  const order = options.order ?? (sort === 'newest' ? 'desc' : 'asc');

  try {
    let query = supabase
      .from('products')
      .select('id, name, slug, description, brand, category, image_url, gtin, confidence_score, data_freshness, created_at, updated_at', {
        count: 'exact',
      })
      .is('deleted_at', null)
      // Exclude the database health-check row ('sample-laptop'). Every
      // other caller already excludes it (recommendations, bundles,
      // gifts, sustainability); this was the one leak, surfacing it
      // in the public products API and the /brands/* + /categories/*
      // pages. Excluding in the query (not post-filtering) keeps the
      // exact count / pagination honest. The row itself stays in the
      // live database for health checks — it is never deleted here.
      .neq('slug', 'sample-laptop')
      .order(sort === 'name' ? 'name' : 'created_at', { ascending: order === 'asc' });

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

    // Price sort needs the merchant prices first: fetch the whole
    // filtered set (capped at 100 rows, the pageSize max) unsliced,
    // sort in memory, then slice the requested page below.
    if (sort === 'price') {
      query = query.range(0, 99);
    } else {
      query = query.range(offset, offset + pageSize - 1);
    }

    const { data, error, count } = await query;

    if (error) {
      logger.warn('getProducts: query failed', { error: error.message });
      return { products: [], total: 0, page, pageSize, totalPages: 0 };
    }

    let products = (data ?? []).map(mapProduct);
    const total = count ?? 0;
    const totalPages = Math.ceil(total / pageSize);

    if (sort === 'price') {
      const lowest = await getLowestMerchantPrices(
        supabase,
        products.map((p) => p.id)
      );
      products = [...products].sort((a, b) => {
        const pa = lowest.get(a.id)?.price ?? null;
        const pb = lowest.get(b.id)?.price ?? null;
        if (pa === null && pb === null) return 0;
        if (pa === null) return 1;
        if (pb === null) return -1;
        return order === 'asc' ? pa - pb : pb - pa;
      });
      products = products.slice(offset, offset + pageSize);
    }

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
      .neq('slug', 'sample-laptop')
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
 *
 * The 'sample-laptop' health-check row is excluded here, so it can
 * never render as a public product page, SEO record, OG image, or
 * [slug] sub-resource (merchants, prices, deals, QA, reviews) — all
 * of those resolve through this function or getCachedProductBySlug.
 * The row itself stays in the live database for health checks.
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
      .neq('slug', 'sample-laptop')
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
      .select('slug, category')
      .not('category', 'is', null)
      .neq('slug', 'sample-laptop')
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
      .select('slug, brand')
      .not('brand', 'is', null)
      .neq('slug', 'sample-laptop')
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
