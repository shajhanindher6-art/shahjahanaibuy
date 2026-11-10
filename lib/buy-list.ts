/**
 * Buy-list shortlist (Section 6, Item 1 — trimmed audit design).
 *
 * A buy list is a SHORTLIST, not a checkout: SmartBuy never charges
 * the user and never takes payment. The user checks out at the
 * retailer via the Where-to-Buy link.
 *
 * HONESTY: no price column is stored anywhere (migration 033 creates
 * buy_list_items with product/merchant references + quantity only).
 * Prices are re-read at view time from merchant_products (the
 * lowest recorded listing) or the latest price_history, so a
 * shortlist can never show a stale stored price.
 *
 * Graceful degradation: migration 033 must be run once by the owner.
 * Until then the table does not exist and every read fails safe to
 * an empty list with enabled:false (PostgREST reports a missing
 * table as PGRST205, Postgres as 42P01 — both count).
 */

import type { SupabaseClient } from '@supabase/supabase-js';

/** Supabase client type (type-only import — no runtime dependency). */
export type BuyListDb = SupabaseClient;

export const BUY_LIST_MAX_QUANTITY = 99;

export interface BuyListItemRow {
  id: string;
  user_id: string;
  product_id: string;
  merchant_product_id: string | null;
  quantity: number;
  created_at: string;
}

export interface BuyListItemView extends BuyListItemRow {
  productName: string | null;
  productSlug: string | null;
  /** Lowest recorded merchant_products price, re-read at view time. Null = not recorded. */
  livePriceUsd: number | null;
  /** Lowest-price retailer's name, or the pinned merchant's name. Null when unknown. */
  merchantName: string | null;
  /** Retailer link-out (a search link, never an invented product URL). Null when none recorded. */
  buyUrl: string | null;
}

/** PostgREST reports a missing table as PGRST205, Postgres as 42P01. */
export function isMissingTableError(error: { code?: string } | null | undefined): boolean {
  return error?.code === '42P01' || error?.code === 'PGRST205';
}

/**
 * Validate a requested quantity. Accepts integers 1..99; anything
 * else (0, negative, fractional, NaN, non-number) returns null so
 * the caller can answer 400/422 instead of storing a bad value.
 */
export function normalizeQuantity(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (!Number.isInteger(value)) return null;
  if (value < 1 || value > BUY_LIST_MAX_QUANTITY) return null;
  return value;
}

interface MerchantListingRow {
  id: string;
  product_id: string;
  merchant_id: string;
  price: number | string;
  url: string | null;
}

interface ProductRow {
  id: string;
  name: string | null;
  slug: string | null;
}

interface MerchantRow {
  id: string;
  name: string | null;
}

/**
 * Read the user's buy list, enriching each row with the product
 * name/slug and the live re-read price. Returns enabled:false when
 * the table does not exist yet (migration 033 not run) — never a
 * crash, never an invented price.
 */
export async function getBuyList(
  supabase: BuyListDb,
  userId: string
): Promise<{ items: BuyListItemView[]; enabled: boolean; error?: { code?: string } }> {
  const { data, error } = await supabase
    .from('buy_list_items')
    .select('id, user_id, product_id, merchant_product_id, quantity, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) {
    if (isMissingTableError(error)) return { items: [], enabled: false };
    return { items: [], enabled: true, error };
  }
  const rows = (data ?? []) as BuyListItemRow[];
  if (rows.length === 0) return { items: [], enabled: true };

  const productIds = [...new Set(rows.map((r) => r.product_id))];
  const { data: products } = await supabase
    .from('products')
    .select('id, name, slug')
    .in('id', productIds);
  const productById = new Map<string, ProductRow>();
  for (const p of (products ?? []) as ProductRow[]) productById.set(p.id, p);

  // Live prices, re-read at view time: every recorded listing for
  // these products. The pinned merchant_product_id (if any) wins;
  // otherwise the lowest recorded price is shown.
  const { data: listings } = await supabase
    .from('merchant_products')
    .select('id, product_id, merchant_id, price, url')
    .in('product_id', productIds);
  const listingRows = (listings ?? []) as MerchantListingRow[];
  const merchantIds = [...new Set(listingRows.map((l) => l.merchant_id))];
  const merchantById = new Map<string, string | null>();
  if (merchantIds.length > 0) {
    const { data: merchants } = await supabase
      .from('merchants')
      .select('id, name')
      .in('id', merchantIds);
    for (const m of (merchants ?? []) as MerchantRow[]) merchantById.set(m.id, m.name);
  }
  const listingsByProduct = new Map<string, MerchantListingRow[]>();
  for (const l of listingRows) {
    const list = listingsByProduct.get(l.product_id) ?? [];
    list.push(l);
    listingsByProduct.set(l.product_id, list);
  }

  const items: BuyListItemView[] = rows.map((row) => {
    const product = productById.get(row.product_id);
    const candidates = listingsByProduct.get(row.product_id) ?? [];
    const pinned = row.merchant_product_id
      ? candidates.find((l) => l.id === row.merchant_product_id) ?? null
      : null;
    const priced = candidates.filter((l) => Number(l.price) > 0);
    const chosen =
      pinned ??
      priced.sort((a, b) => Number(a.price) - Number(b.price))[0] ??
      null;
    return {
      ...row,
      productName: product?.name ?? null,
      productSlug: product?.slug ?? null,
      livePriceUsd: chosen ? Number(chosen.price) : null,
      merchantName: chosen ? (merchantById.get(chosen.merchant_id) ?? null) : null,
      buyUrl: chosen?.url ?? null,
    };
  });
  return { items, enabled: true };
}

/**
 * Add a product to the user's buy list. Dedupe: the table has
 * UNIQUE (user_id, product_id, merchant_product_id), so adding a
 * product that is already listed bumps its quantity (capped at 99)
 * instead of creating a duplicate row.
 */
export async function addBuyListItem(
  supabase: BuyListDb,
  userId: string,
  input: { productId: string; merchantProductId?: string | null; quantity?: number }
): Promise<
  | { item: BuyListItemRow; deduped: boolean }
  | { error: { code?: string; message: string }; missingTable?: boolean }
> {
  const quantity = normalizeQuantity(input.quantity ?? 1) ?? 1;
  const merchantProductId = input.merchantProductId ?? null;

  // Dedupe check first (NULL merchant_product_id needs .is(), not .eq()).
  let existingQuery = supabase
    .from('buy_list_items')
    .select('id, user_id, product_id, merchant_product_id, quantity, created_at')
    .eq('user_id', userId)
    .eq('product_id', input.productId);
  existingQuery =
    merchantProductId === null
      ? existingQuery.is('merchant_product_id', null)
      : existingQuery.eq('merchant_product_id', merchantProductId);
  const { data: existing, error: existingError } = await existingQuery.maybeSingle();
  if (existingError) {
    if (isMissingTableError(existingError)) return { error: existingError, missingTable: true };
    return { error: { code: existingError.code, message: 'Failed to read buy list' } };
  }
  if (existing) {
    const row = existing as BuyListItemRow;
    const bumped = Math.min(BUY_LIST_MAX_QUANTITY, row.quantity + quantity);
    const { data, error } = await supabase
      .from('buy_list_items')
      .update({ quantity: bumped })
      .eq('id', row.id)
      .eq('user_id', userId)
      .select('id, user_id, product_id, merchant_product_id, quantity, created_at')
      .single();
    if (error || !data) {
      return { error: { code: error?.code, message: 'Failed to update buy list item' } };
    }
    return { item: data as BuyListItemRow, deduped: true };
  }

  const { data, error } = await supabase
    .from('buy_list_items')
    .insert({
      user_id: userId,
      product_id: input.productId,
      merchant_product_id: merchantProductId,
      quantity,
    })
    .select('id, user_id, product_id, merchant_product_id, quantity, created_at')
    .single();
  if (error || !data) {
    if (isMissingTableError(error)) return { error, missingTable: true };
    return { error: { code: error?.code, message: 'Failed to add buy list item' } };
  }
  return { item: data as BuyListItemRow, deduped: false };
}

/** Owner-scoped quantity update. Returns null when not found / not owned. */
export async function updateBuyListQuantity(
  supabase: BuyListDb,
  userId: string,
  itemId: string,
  quantity: number
): Promise<BuyListItemRow | null> {
  const { data, error } = await supabase
    .from('buy_list_items')
    .update({ quantity })
    .eq('id', itemId)
    .eq('user_id', userId)
    .select('id, user_id, product_id, merchant_product_id, quantity, created_at')
    .single();
  if (error || !data) return null;
  return data as BuyListItemRow;
}

/** Owner-scoped delete. Returns false when not found / not owned. */
export async function removeBuyListItem(
  supabase: BuyListDb,
  userId: string,
  itemId: string
): Promise<boolean> {
  // select() after delete: an empty result means no row matched
  // (not found or not owned) — a bare delete reports no error for
  // zero rows, so it cannot distinguish the two cases.
  const { data, error } = await supabase
    .from('buy_list_items')
    .delete()
    .eq('id', itemId)
    .eq('user_id', userId)
    .select('id');
  if (error) return false;
  return Array.isArray(data) && data.length > 0;
}
