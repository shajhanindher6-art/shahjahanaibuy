/**
 * Catalog reference data service.
 * Reads from the `brands`, `categories`, `tags`, `currencies`, `countries`,
 * `languages`, and `providers` reference tables (migrations 003).
 *
 * All functions accept an `AnySupabaseClient` so they work with both the
 * browser (anon, RLS-enforced) and server (service role) clients.
 *
 * Database snake_case columns are mapped to camelCase TypeScript properties.
 */

import type { AnySupabaseClient } from '@/lib/supabase/types';
import { logger } from '@/lib/config/logger';
import type {
  Brand,
  Category,
  Tag,
  Currency,
  Country,
  Language,
  Provider,
} from '@/types/catalog';

// ---------------------------------------------------------------------------
// Row → domain mappers
// ---------------------------------------------------------------------------

interface BrandRow {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  description: string | null;
  country_id: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

function mapBrand(row: BrandRow): Brand {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    logoUrl: row.logo_url,
    description: row.description,
    countryId: row.country_id,
    active: row.active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

interface CategoryRow {
  id: string;
  name: string;
  slug: string;
  parent_id: string | null;
  description: string | null;
  icon: string | null;
  sort_order: number;
  active: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

function mapCategory(row: CategoryRow): Category {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    parentId: row.parent_id,
    description: row.description,
    icon: row.icon,
    sortOrder: row.sort_order,
    active: row.active,
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

interface CurrencyRow {
  id: string;
  code: string;
  name: string;
  symbol: string | null;
  decimal_places: number;
  active: boolean;
}

function mapCurrency(row: CurrencyRow): Currency {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    symbol: row.symbol,
    decimalPlaces: row.decimal_places,
    active: row.active,
  };
}

interface CountryRow {
  id: string;
  code: string;
  name: string;
  currency_id: string | null;
  active: boolean;
}

function mapCountry(row: CountryRow): Country {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    currencyId: row.currency_id,
    active: row.active,
  };
}

interface LanguageRow {
  id: string;
  code: string;
  name: string;
  native_name: string | null;
  active: boolean;
}

function mapLanguage(row: LanguageRow): Language {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    nativeName: row.native_name,
    active: row.active,
  };
}

interface ProviderRow {
  id: string;
  key: string;
  name: string;
  type: string;
  base_url: string | null;
  api_key_env: string | null;
  active: boolean;
  rate_limit_per_minute: number;
  priority: number;
}

function mapProvider(row: ProviderRow): Provider {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    type: row.type,
    baseUrl: row.base_url,
    apiKeyEnv: row.api_key_env,
    active: row.active,
    rateLimitPerMinute: row.rate_limit_per_minute,
    priority: row.priority,
  };
}

// ---------------------------------------------------------------------------
// Brands
// ---------------------------------------------------------------------------

/**
 * List all active brands from the `brands` table, ordered by name.
 * Soft-deleted brands (deleted_at IS NOT NULL) are excluded.
 */
export async function getBrandList(
  supabase: AnySupabaseClient
): Promise<Brand[]> {
  try {
    const { data, error } = await supabase
      .from('brands')
      .select('id, name, slug, logo_url, description, country_id, active, created_at, updated_at, deleted_at')
      .eq('active', true)
      .is('deleted_at', null)
      .order('name', { ascending: true })
      .limit(500);

    if (error || !data) {
      if (error) logger.warn('getBrandList: query failed', { error: error.message });
      return [];
    }

    return data.map((row) => mapBrand(row as BrandRow));
  } catch (err) {
    logger.error('getBrandList: unexpected error', { error: String(err) });
    return [];
  }
}

/**
 * Fetch a single brand by slug.
 * Returns `null` if not found or on error.
 */
export async function getBrandBySlug(
  supabase: AnySupabaseClient,
  slug: string
): Promise<Brand | null> {
  try {
    const { data, error } = await supabase
      .from('brands')
      .select('id, name, slug, logo_url, description, country_id, active, created_at, updated_at, deleted_at')
      .eq('slug', slug)
      .eq('active', true)
      .is('deleted_at', null)
      .maybeSingle();

    if (error || !data) {
      if (error) logger.warn('getBrandBySlug: query failed', { error: error.message });
      return null;
    }

    return mapBrand(data as BrandRow);
  } catch (err) {
    logger.error('getBrandBySlug: unexpected error', { error: String(err) });
    return null;
  }
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

/**
 * Fetch all active categories and build a hierarchical tree.
 * Top-level categories (parent_id IS NULL) become roots; their `children`
 * arrays are populated with direct descendants.
 */
export async function getCategoryTree(
  supabase: AnySupabaseClient
): Promise<Category[]> {
  try {
    const { data, error } = await supabase
      .from('categories')
      .select('id, name, slug, parent_id, description, icon, sort_order, active, created_at, updated_at, deleted_at')
      .eq('active', true)
      .is('deleted_at', null)
      .order('sort_order', { ascending: true })
      .limit(500);

    if (error || !data) {
      if (error) logger.warn('getCategoryTree: query failed', { error: error.message });
      return [];
    }

    const allCategories = data.map((row) => mapCategory(row as CategoryRow));

    // Build tree: map of id → category, then attach children to parents
    const categoryMap = new Map<string, Category>();
    for (const cat of allCategories) {
      categoryMap.set(cat.id, { ...cat, children: [] });
    }

    const roots: Category[] = [];
    for (const cat of allCategories) {
      const node = categoryMap.get(cat.id)!;
      if (cat.parentId && categoryMap.has(cat.parentId)) {
        categoryMap.get(cat.parentId)!.children!.push(node);
      } else {
        roots.push(node);
      }
    }

    return roots;
  } catch (err) {
    logger.error('getCategoryTree: unexpected error', { error: String(err) });
    return [];
  }
}

/**
 * Fetch a single category by slug.
 * Returns `null` if not found or on error.
 */
export async function getCategoryBySlug(
  supabase: AnySupabaseClient,
  slug: string
): Promise<Category | null> {
  try {
    const { data, error } = await supabase
      .from('categories')
      .select('id, name, slug, parent_id, description, icon, sort_order, active, created_at, updated_at, deleted_at')
      .eq('slug', slug)
      .eq('active', true)
      .is('deleted_at', null)
      .maybeSingle();

    if (error || !data) {
      if (error) logger.warn('getCategoryBySlug: query failed', { error: error.message });
      return null;
    }

    return mapCategory(data as CategoryRow);
  } catch (err) {
    logger.error('getCategoryBySlug: unexpected error', { error: String(err) });
    return null;
  }
}

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

/**
 * List all tags, ordered by name.
 */
export async function getTagList(
  supabase: AnySupabaseClient
): Promise<Tag[]> {
  try {
    const { data, error } = await supabase
      .from('tags')
      .select('id, name, slug, description')
      .order('name', { ascending: true })
      .limit(500);

    if (error || !data) {
      if (error) logger.warn('getTagList: query failed', { error: error.message });
      return [];
    }

    return data.map((row) => mapTag(row as TagRow));
  } catch (err) {
    logger.error('getTagList: unexpected error', { error: String(err) });
    return [];
  }
}

// ---------------------------------------------------------------------------
// Reference data: currencies, countries, languages, providers
// ---------------------------------------------------------------------------

/**
 * List all active currencies, ordered by code.
 */
export async function getCurrencies(
  supabase: AnySupabaseClient
): Promise<Currency[]> {
  try {
    const { data, error } = await supabase
      .from('currencies')
      .select('id, code, name, symbol, decimal_places, active')
      .eq('active', true)
      .order('code', { ascending: true })
      .limit(50);

    if (error || !data) {
      if (error) logger.warn('getCurrencies: query failed', { error: error.message });
      return [];
    }

    return data.map((row) => mapCurrency(row as CurrencyRow));
  } catch (err) {
    logger.error('getCurrencies: unexpected error', { error: String(err) });
    return [];
  }
}

/**
 * List all active countries, ordered by name.
 */
export async function getCountries(
  supabase: AnySupabaseClient
): Promise<Country[]> {
  try {
    const { data, error } = await supabase
      .from('countries')
      .select('id, code, name, currency_id, active')
      .eq('active', true)
      .order('name', { ascending: true })
      .limit(300);

    if (error || !data) {
      if (error) logger.warn('getCountries: query failed', { error: error.message });
      return [];
    }

    return data.map((row) => mapCountry(row as CountryRow));
  } catch (err) {
    logger.error('getCountries: unexpected error', { error: String(err) });
    return [];
  }
}

/**
 * List all active languages, ordered by name.
 */
export async function getLanguages(
  supabase: AnySupabaseClient
): Promise<Language[]> {
  try {
    const { data, error } = await supabase
      .from('languages')
      .select('id, code, name, native_name, active')
      .eq('active', true)
      .order('name', { ascending: true })
      .limit(100);

    if (error || !data) {
      if (error) logger.warn('getLanguages: query failed', { error: error.message });
      return [];
    }

    return data.map((row) => mapLanguage(row as LanguageRow));
  } catch (err) {
    logger.error('getLanguages: unexpected error', { error: String(err) });
    return [];
  }
}

/**
 * List all providers, ordered by priority (lower = higher priority).
 */
export async function getProviders(
  supabase: AnySupabaseClient
): Promise<Provider[]> {
  try {
    const { data, error } = await supabase
      .from('providers')
      .select('id, key, name, type, base_url, api_key_env, active, rate_limit_per_minute, priority')
      .order('priority', { ascending: true })
      .limit(50);

    if (error || !data) {
      if (error) logger.warn('getProviders: query failed', { error: error.message });
      return [];
    }

    return data.map((row) => mapProvider(row as ProviderRow));
  } catch (err) {
    logger.error('getProviders: unexpected error', { error: String(err) });
    return [];
  }
}
