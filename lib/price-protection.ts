/**
 * Price-drop protection watch (Section 6, Item 7 — trimmed audit design).
 *
 * A watch is created from a Receipt Vault item (supabase/
 * add-receipt-vault.sql) after a purchase. The purchase price is
 * COPIED from the vault item's recorded amount at creation — a watch
 * with no recorded amount cannot be created (the API answers 400).
 *
 * HONESTY: eligibility is DERIVED on view from recorded
 * price_history, never stored. The migration's status column only
 * ever holds 'pending' or 'claim_submitted' from this code; the
 * derived values ('eligible' / 'not_eligible' / 'no_data' /
 * 'expired') are computed fresh on every read. A claim is a
 * user-submitted record for review — NO refund is promised and no
 * refund amount is ever stated.
 *
 * Graceful degradation: migration 033 creates
 * price_protection_watches only if standalone vault_items exists,
 * and only after the owner runs it. Until then reads fail safe to
 * an empty list with enabled:false (PGRST205 / 42P01 both count).
 */

import type { SupabaseClient } from '@supabase/supabase-js';

/** Supabase client type (type-only import — no runtime dependency). */
export type PriceProtectionDb = SupabaseClient;

export type ProtectionEligibility = 'eligible' | 'not_eligible' | 'no_data' | 'expired';

export const PRICE_PROTECTION_DEFAULT_WINDOW_DAYS = 30;

export interface PricePoint {
  price: number | null;
  recordedAt: string;
}

export interface ProtectionWatchRow {
  id: string;
  user_id: string;
  vault_item_id: string;
  product_id: string;
  retailer_id: string | null;
  purchase_price: number | null;
  window_days: number;
  status: string;
  created_at: string;
}

export interface ProtectionWatchView extends ProtectionWatchRow {
  productName: string | null;
  productSlug: string | null;
  purchaseDate: string | null;
  /** purchase_date + window_days (ISO date). */
  windowEndDate: string | null;
  /** Derived on view from recorded price_history — never stored. */
  eligibility: ProtectionEligibility;
  /** Lowest recorded price inside the window, or null when none. */
  lowestInWindowPriceUsd: number | null;
}

/** PostgREST reports a missing table as PGRST205, Postgres as 42P01. */
export function isMissingTableError(error: { code?: string } | null | undefined): boolean {
  return error?.code === '42P01' || error?.code === 'PGRST205';
}

/**
 * Window end = purchase date + window_days. The window is
 * (purchase_date, purchase_date + window_days]: a price recorded
 * ON the purchase date itself is the purchase, not a drop.
 */
export function windowEndDate(purchaseDate: string, windowDays: number): string | null {
  const start = new Date(purchaseDate);
  if (Number.isNaN(start.getTime())) return null;
  const end = new Date(start.getTime() + windowDays * 24 * 60 * 60 * 1000);
  return end.toISOString();
}

/** Lowest recorded price strictly inside the window, or null. */
export function lowestInWindowPrice(
  purchaseDate: string,
  windowDays: number,
  pricePoints: PricePoint[]
): number | null {
  const start = new Date(purchaseDate);
  if (Number.isNaN(start.getTime()) || !(windowDays > 0)) return null;
  const end = new Date(start.getTime() + windowDays * 24 * 60 * 60 * 1000);
  let lowest: number | null = null;
  for (const point of pricePoints) {
    if (point.price === null || !Number.isFinite(point.price)) continue;
    const at = new Date(point.recordedAt);
    if (Number.isNaN(at.getTime())) continue;
    if (at.getTime() <= start.getTime() || at.getTime() > end.getTime()) continue;
    if (lowest === null || point.price < lowest) lowest = point.price;
  }
  return lowest;
}

/**
 * Derive eligibility from recorded price history.
 *
 * - 'no_data': no recorded purchase price, an invalid window, or
 *   fewer than 1 recorded price point inside the window.
 * - 'eligible': the lowest recorded in-window price is below the
 *   recorded purchase price.
 * - 'expired': the window has closed (now > window end) with no
 *   in-window price below the purchase price.
 * - 'not_eligible': the window is still open and no in-window price
 *   has dropped below the purchase price yet.
 */
export function checkProtectionEligibility(input: {
  purchasePrice: number | null | undefined;
  purchaseDate: string;
  windowDays: number;
  pricePoints: PricePoint[];
  now?: Date;
}): ProtectionEligibility {
  const { purchasePrice, purchaseDate, windowDays, pricePoints } = input;
  const now = input.now ?? new Date();
  if (purchasePrice === null || purchasePrice === undefined || !Number.isFinite(purchasePrice)) {
    return 'no_data';
  }
  const start = new Date(purchaseDate);
  if (Number.isNaN(start.getTime()) || !(windowDays > 0)) return 'no_data';
  const end = new Date(start.getTime() + windowDays * 24 * 60 * 60 * 1000);

  const inWindow = pricePoints.filter((point) => {
    if (point.price === null || !Number.isFinite(point.price)) return false;
    const at = new Date(point.recordedAt);
    if (Number.isNaN(at.getTime())) return false;
    return at.getTime() > start.getTime() && at.getTime() <= end.getTime();
  });
  if (inWindow.length < 1) return 'no_data';

  const lowest = Math.min(...inWindow.map((p) => p.price as number));
  if (lowest < purchasePrice) return 'eligible';
  if (now.getTime() > end.getTime()) return 'expired';
  return 'not_eligible';
}

/** Only 'claim_submitted' is a valid status change from the API. */
export function isValidStatusTransition(status: unknown): status is 'claim_submitted' {
  return status === 'claim_submitted';
}

const WATCH_SELECT =
  'id, user_id, vault_item_id, product_id, retailer_id, purchase_price, window_days, status, created_at';

/**
 * Read the user's watches with eligibility derived on view from
 * recorded price_history. Returns enabled:false when the table
 * does not exist yet (migration 033 / vault SQL not run).
 */
export async function getPriceProtectionWatches(
  supabase: PriceProtectionDb,
  userId: string
): Promise<{ watches: ProtectionWatchView[]; enabled: boolean; error?: { code?: string } }> {
  const { data, error } = await supabase
    .from('price_protection_watches')
    .select(WATCH_SELECT)
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) {
    if (isMissingTableError(error)) return { watches: [], enabled: false };
    return { watches: [], enabled: true, error };
  }
  const rows = (data ?? []) as ProtectionWatchRow[];
  if (rows.length === 0) return { watches: [], enabled: true };

  const vaultIds = [...new Set(rows.map((r) => r.vault_item_id))];
  const productIds = [...new Set(rows.map((r) => r.product_id))];
  const { data: vaultItems } = await supabase
    .from('vault_items')
    .select('id, purchase_date')
    .in('id', vaultIds);
  const purchaseDateByVault = new Map<string, string>();
  for (const v of (vaultItems ?? []) as Array<{ id: string; purchase_date: string }>) {
    purchaseDateByVault.set(v.id, v.purchase_date);
  }
  const { data: products } = await supabase
    .from('products')
    .select('id, name, slug')
    .in('id', productIds);
  const productById = new Map<string, { name: string | null; slug: string | null }>();
  for (const p of (products ?? []) as Array<{ id: string; name: string | null; slug: string | null }>) {
    productById.set(p.id, p);
  }
  const { data: history } = await supabase
    .from('price_history')
    .select('product_id, price, recorded_at')
    .in('product_id', productIds)
    .order('recorded_at', { ascending: true });
  const pointsByProduct = new Map<string, PricePoint[]>();
  for (const h of (history ?? []) as Array<{ product_id: string; price: number; recorded_at: string }>) {
    const list = pointsByProduct.get(h.product_id) ?? [];
    list.push({ price: Number(h.price), recordedAt: h.recorded_at });
    pointsByProduct.set(h.product_id, list);
  }

  const now = new Date();
  const watches: ProtectionWatchView[] = rows.map((row) => {
    const purchaseDate = purchaseDateByVault.get(row.vault_item_id) ?? null;
    const product = productById.get(row.product_id);
    const points = pointsByProduct.get(row.product_id) ?? [];
    const eligibility =
      purchaseDate === null
        ? ('no_data' as const)
        : checkProtectionEligibility({
            purchasePrice: row.purchase_price,
            purchaseDate,
            windowDays: row.window_days,
            pricePoints: points,
            now,
          });
    return {
      ...row,
      productName: product?.name ?? null,
      productSlug: product?.slug ?? null,
      purchaseDate,
      windowEndDate:
        purchaseDate === null ? null : windowEndDate(purchaseDate, row.window_days),
      eligibility,
      lowestInWindowPriceUsd:
        purchaseDate === null ? null : lowestInWindowPrice(purchaseDate, row.window_days, points),
    };
  });
  return { watches, enabled: true };
}

export interface VaultItemForWatch {
  id: string;
  product_id: string | null;
  purchase_date: string;
  amount: number | null;
  retailer_id?: string | null;
}

/**
 * Create a watch from one of the user's vault items. The purchase
 * price is copied from the vault item's recorded amount — a vault
 * item with no recorded amount cannot be watched (returns an
 * error the route turns into a 400). One watch per vault item
 * (UNIQUE (user_id, vault_item_id)): a second create returns the
 * existing watch instead of duplicating it.
 */
export async function createPriceProtectionWatch(
  supabase: PriceProtectionDb,
  userId: string,
  vaultItem: VaultItemForWatch,
  windowDays: number = PRICE_PROTECTION_DEFAULT_WINDOW_DAYS
): Promise<
  | { watch: ProtectionWatchRow; deduped: boolean }
  | { error: { code?: string; message: string }; missingTable?: boolean; noAmount?: boolean }
> {
  if (vaultItem.amount === null || !Number.isFinite(vaultItem.amount) || vaultItem.amount <= 0) {
    return {
      error: {
        message:
          'This vault item has no recorded purchase amount, so a price-drop protection watch cannot be created for it.',
      },
      noAmount: true,
    };
  }
  if (!vaultItem.product_id) {
    return {
      error: {
        message: 'This vault item is not linked to a catalog product, so it cannot be watched.',
      },
    };
  }

  const { data: existing, error: existingError } = await supabase
    .from('price_protection_watches')
    .select(WATCH_SELECT)
    .eq('user_id', userId)
    .eq('vault_item_id', vaultItem.id)
    .maybeSingle();
  if (existingError) {
    if (isMissingTableError(existingError)) return { error: existingError, missingTable: true };
    return { error: { code: existingError.code, message: 'Failed to read protection watches' } };
  }
  if (existing) return { watch: existing as ProtectionWatchRow, deduped: true };

  const { data, error } = await supabase
    .from('price_protection_watches')
    .insert({
      user_id: userId,
      vault_item_id: vaultItem.id,
      product_id: vaultItem.product_id,
      retailer_id: vaultItem.retailer_id ?? null,
      purchase_price: vaultItem.amount,
      window_days: windowDays,
      status: 'pending',
    })
    .select(WATCH_SELECT)
    .single();
  if (error || !data) {
    if (isMissingTableError(error)) return { error, missingTable: true };
    return { error: { code: error?.code, message: 'Failed to create protection watch' } };
  }
  return { watch: data as ProtectionWatchRow, deduped: false };
}

/**
 * Mark a watch's claim as submitted (the only status change the
 * API allows). A claim is a user-submitted record for review — no
 * refund is promised and no refund amount is stated. Returns null
 * when not found / not owned.
 */
export async function submitProtectionClaim(
  supabase: PriceProtectionDb,
  userId: string,
  watchId: string
): Promise<ProtectionWatchRow | null> {
  const { data, error } = await supabase
    .from('price_protection_watches')
    .update({ status: 'claim_submitted' })
    .eq('id', watchId)
    .eq('user_id', userId)
    .select(WATCH_SELECT)
    .single();
  if (error || !data) return null;
  return data as ProtectionWatchRow;
}

/** Owner-scoped delete. Returns false when not found / not owned. */
export async function deletePriceProtectionWatch(
  supabase: PriceProtectionDb,
  userId: string,
  watchId: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from('price_protection_watches')
    .delete()
    .eq('id', watchId)
    .eq('user_id', userId)
    .select('id');
  if (error) return false;
  return Array.isArray(data) && data.length > 0;
}
