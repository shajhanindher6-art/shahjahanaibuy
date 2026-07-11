/**
 * Commerce data access service.
 * Reads from the `merchants`, `merchant_products`, `deals`, `coupons`,
 * and `cashback_offers` tables (migration 005).
 *
 * All functions accept an `AnySupabaseClient` so they work with both the
 * browser (anon, RLS-enforced) and server (service role) clients.
 *
 * Database snake_case columns are mapped to camelCase TypeScript properties.
 * Numeric price/discount values are parsed via `parseFloat()`.
 */

import type { AnySupabaseClient } from '@/lib/supabase/types';
import { logger } from '@/lib/config/logger';
import type {
  Merchant,
  MerchantProduct,
  Deal,
  Coupon,
  CashbackOffer,
} from '@/types/catalog';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DealListOptions {
  productId?: string;
  active?: boolean;
  limit?: number;
}

export interface CouponListOptions {
  merchantId?: string;
  active?: boolean;
  limit?: number;
}

export interface CashbackListOptions {
  merchantId?: string;
  productId?: string;
  active?: boolean;
  limit?: number;
}

// ---------------------------------------------------------------------------
// Row → domain mappers
// ---------------------------------------------------------------------------

interface MerchantRow {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  website_url: string | null;
  country_id: string | null;
  currency_id: string | null;
  contact_email: string | null;
  phone: string | null;
  status: string;
  commission_rate: number | string;
  active: boolean;
  created_at: string;
  updated_at: string;
}

function mapMerchant(row: MerchantRow): Merchant {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    logoUrl: row.logo_url,
    websiteUrl: row.website_url,
    countryId: row.country_id,
    currencyId: row.currency_id,
    contactEmail: row.contact_email,
    phone: row.phone,
    status: row.status,
    commissionRate: parseFloat(String(row.commission_rate)),
    active: row.active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

interface MerchantProductRow {
  id: string;
  product_id: string;
  merchant_id: string;
  merchant_sku: string | null;
  price: number | string;
  compare_at_price: number | string | null;
  currency_id: string | null;
  availability: string;
  url: string | null;
  shipping_cost: number | string | null;
  shipping_days: number | null;
  in_stock: boolean;
  stock_quantity: number | null;
  last_synced_at: string | null;
}

function mapMerchantProduct(row: MerchantProductRow): MerchantProduct {
  return {
    id: row.id,
    productId: row.product_id,
    merchantId: row.merchant_id,
    merchantSku: row.merchant_sku,
    price: parseFloat(String(row.price)),
    compareAtPrice: row.compare_at_price !== null ? parseFloat(String(row.compare_at_price)) : null,
    currencyId: row.currency_id,
    availability: row.availability,
    url: row.url,
    shippingCost: row.shipping_cost !== null ? parseFloat(String(row.shipping_cost)) : null,
    shippingDays: row.shipping_days,
    inStock: row.in_stock,
    stockQuantity: row.stock_quantity,
    lastSyncedAt: row.last_synced_at,
  };
}

interface DealRow {
  id: string;
  product_id: string;
  merchant_id: string | null;
  title: string;
  description: string | null;
  deal_type: string;
  discount_type: string;
  discount_value: number | string;
  start_at: string;
  end_at: string;
  coupon_code: string | null;
  url: string | null;
  active: boolean;
}

function mapDeal(row: DealRow): Deal {
  return {
    id: row.id,
    productId: row.product_id,
    merchantId: row.merchant_id,
    title: row.title,
    description: row.description,
    dealType: row.deal_type,
    discountType: row.discount_type,
    discountValue: parseFloat(String(row.discount_value)),
    startAt: row.start_at,
    endAt: row.end_at,
    couponCode: row.coupon_code,
    url: row.url,
    active: row.active,
  };
}

interface CouponRow {
  id: string;
  code: string;
  merchant_id: string | null;
  description: string | null;
  discount_type: string;
  discount_value: number | string;
  min_order_value: number | string | null;
  max_discount_amount: number | string | null;
  usage_limit: number | null;
  usage_count: number;
  per_user_limit: number;
  valid_from: string;
  valid_until: string | null;
  active: boolean;
}

function mapCoupon(row: CouponRow): Coupon {
  return {
    id: row.id,
    code: row.code,
    merchantId: row.merchant_id,
    description: row.description,
    discountType: row.discount_type,
    discountValue: parseFloat(String(row.discount_value)),
    minOrderValue: row.min_order_value !== null ? parseFloat(String(row.min_order_value)) : null,
    maxDiscountAmount: row.max_discount_amount !== null ? parseFloat(String(row.max_discount_amount)) : null,
    usageLimit: row.usage_limit,
    usageCount: row.usage_count,
    perUserLimit: row.per_user_limit,
    validFrom: row.valid_from,
    validUntil: row.valid_until,
    active: row.active,
  };
}

interface CashbackOfferRow {
  id: string;
  merchant_id: string;
  product_id: string | null;
  title: string;
  description: string | null;
  cashback_type: string;
  cashback_value: number | string;
  max_cashback_amount: number | string | null;
  start_at: string;
  end_at: string;
  terms_url: string | null;
  active: boolean;
}

function mapCashbackOffer(row: CashbackOfferRow): CashbackOffer {
  return {
    id: row.id,
    merchantId: row.merchant_id,
    productId: row.product_id,
    title: row.title,
    description: row.description,
    cashbackType: row.cashback_type,
    cashbackValue: parseFloat(String(row.cashback_value)),
    maxCashbackAmount: row.max_cashback_amount !== null ? parseFloat(String(row.max_cashback_amount)) : null,
    startAt: row.start_at,
    endAt: row.end_at,
    termsUrl: row.terms_url,
    active: row.active,
  };
}

// ---------------------------------------------------------------------------
// Merchants
// ---------------------------------------------------------------------------

/**
 * List all active merchants, ordered by name.
 * Soft-deleted merchants are excluded.
 */
export async function getMerchants(
  supabase: AnySupabaseClient
): Promise<Merchant[]> {
  try {
    const { data, error } = await supabase
      .from('merchants')
      .select('id, name, slug, logo_url, website_url, country_id, currency_id, contact_email, phone, status, commission_rate, active, created_at, updated_at')
      .eq('active', true)
      .is('deleted_at', null)
      .order('name', { ascending: true })
      .limit(500);

    if (error || !data) {
      if (error) logger.warn('getMerchants: query failed', { error: error.message });
      return [];
    }

    return data.map((row) => mapMerchant(row as MerchantRow));
  } catch (err) {
    logger.error('getMerchants: unexpected error', { error: String(err) });
    return [];
  }
}

/**
 * Fetch a single merchant by slug.
 * Returns `null` if not found or on error.
 */
export async function getMerchantBySlug(
  supabase: AnySupabaseClient,
  slug: string
): Promise<Merchant | null> {
  try {
    const { data, error } = await supabase
      .from('merchants')
      .select('id, name, slug, logo_url, website_url, country_id, currency_id, contact_email, phone, status, commission_rate, active, created_at, updated_at')
      .eq('slug', slug)
      .eq('active', true)
      .is('deleted_at', null)
      .maybeSingle();

    if (error || !data) {
      if (error) logger.warn('getMerchantBySlug: query failed', { error: error.message });
      return null;
    }

    return mapMerchant(data as MerchantRow);
  } catch (err) {
    logger.error('getMerchantBySlug: unexpected error', { error: String(err) });
    return null;
  }
}

// ---------------------------------------------------------------------------
// Merchant products
// ---------------------------------------------------------------------------

/**
 * Fetch all merchant listings for a given product.
 * Returns active, non-soft-deleted listings ordered by price (ascending).
 */
export async function getMerchantProducts(
  supabase: AnySupabaseClient,
  productId: string
): Promise<MerchantProduct[]> {
  try {
    const { data, error } = await supabase
      .from('merchant_products')
      .select('id, product_id, merchant_id, merchant_sku, price, compare_at_price, currency_id, availability, url, shipping_cost, shipping_days, in_stock, stock_quantity, last_synced_at')
      .eq('product_id', productId)
      .is('deleted_at', null)
      .order('price', { ascending: true })
      .limit(100);

    if (error || !data) {
      if (error) logger.warn('getMerchantProducts: query failed', { error: error.message });
      return [];
    }

    return data.map((row) => mapMerchantProduct(row as MerchantProductRow));
  } catch (err) {
    logger.error('getMerchantProducts: unexpected error', { error: String(err) });
    return [];
  }
}

// ---------------------------------------------------------------------------
// Deals
// ---------------------------------------------------------------------------

/**
 * Fetch active deals, optionally filtered by product ID.
 *
 * @param options.productId Filter deals to a specific product.
 * @param options.active    Filter by active flag (default: true).
 * @param options.limit     Maximum number of deals to return (default 50).
 */
export async function getDeals(
  supabase: AnySupabaseClient,
  options: DealListOptions = {}
): Promise<Deal[]> {
  const limit = Math.min(200, Math.max(1, options.limit ?? 50));
  const active = options.active ?? true;

  try {
    let query = supabase
      .from('deals')
      .select('id, product_id, merchant_id, title, description, deal_type, discount_type, discount_value, start_at, end_at, coupon_code, url, active')
      .eq('active', active)
      .is('deleted_at', null)
      .order('end_at', { ascending: true })
      .limit(limit);

    if (options.productId) {
      query = query.eq('product_id', options.productId);
    }

    const { data, error } = await query;

    if (error || !data) {
      if (error) logger.warn('getDeals: query failed', { error: error.message });
      return [];
    }

    return data.map((row) => mapDeal(row as DealRow));
  } catch (err) {
    logger.error('getDeals: unexpected error', { error: String(err) });
    return [];
  }
}

// ---------------------------------------------------------------------------
// Coupons
// ---------------------------------------------------------------------------

/**
 * Fetch active coupons, optionally filtered by merchant.
 *
 * @param options.merchantId Filter coupons to a specific merchant.
 * @param options.active     Filter by active flag (default: true).
 * @param options.limit      Maximum number of coupons to return (default 50).
 */
export async function getCoupons(
  supabase: AnySupabaseClient,
  options: CouponListOptions = {}
): Promise<Coupon[]> {
  const limit = Math.min(200, Math.max(1, options.limit ?? 50));
  const active = options.active ?? true;

  try {
    let query = supabase
      .from('coupons')
      .select('id, code, merchant_id, description, discount_type, discount_value, min_order_value, max_discount_amount, usage_limit, usage_count, per_user_limit, valid_from, valid_until, active')
      .eq('active', active)
      .order('valid_from', { ascending: false })
      .limit(limit);

    if (options.merchantId) {
      query = query.eq('merchant_id', options.merchantId);
    }

    const { data, error } = await query;

    if (error || !data) {
      if (error) logger.warn('getCoupons: query failed', { error: error.message });
      return [];
    }

    return data.map((row) => mapCoupon(row as CouponRow));
  } catch (err) {
    logger.error('getCoupons: unexpected error', { error: String(err) });
    return [];
  }
}

// ---------------------------------------------------------------------------
// Cashback offers
// ---------------------------------------------------------------------------

/**
 * Fetch active cashback offers, optionally filtered by merchant or product.
 *
 * @param options.merchantId Filter to a specific merchant.
 * @param options.productId  Filter to a specific product.
 * @param options.active     Filter by active flag (default: true).
 * @param options.limit      Maximum number of offers to return (default 50).
 */
export async function getCashbackOffers(
  supabase: AnySupabaseClient,
  options: CashbackListOptions = {}
): Promise<CashbackOffer[]> {
  const limit = Math.min(200, Math.max(1, options.limit ?? 50));
  const active = options.active ?? true;

  try {
    let query = supabase
      .from('cashback_offers')
      .select('id, merchant_id, product_id, title, description, cashback_type, cashback_value, max_cashback_amount, start_at, end_at, terms_url, active')
      .eq('active', active)
      .is('deleted_at', null)
      .order('end_at', { ascending: true })
      .limit(limit);

    if (options.merchantId) {
      query = query.eq('merchant_id', options.merchantId);
    }
    if (options.productId) {
      query = query.eq('product_id', options.productId);
    }

    const { data, error } = await query;

    if (error || !data) {
      if (error) logger.warn('getCashbackOffers: query failed', { error: error.message });
      return [];
    }

    return data.map((row) => mapCashbackOffer(row as CashbackOfferRow));
  } catch (err) {
    logger.error('getCashbackOffers: unexpected error', { error: String(err) });
    return [];
  }
}
