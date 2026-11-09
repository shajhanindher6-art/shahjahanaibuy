/**
 * Tech Budget & Daily Cost-per-Use (Option 16, Step 1 Module 2).
 *
 * Pure budget math lives in lib/analytics/costPerHour.ts. This service
 * owns the database side: one `user_tech_budgets` row per user
 * (migration 019) and the wishlist ownership rollup the dashboard
 * widget compares the budget against.
 *
 * HONESTY RULES (do not weaken them):
 * - Every read is fail-safe: when migration 019 has not been run yet,
 *   getters return null/zeros instead of throwing, so the UI shows an
 *   honest "set up your budget" / "migration pending" state and the
 *   live site never breaks on a missing table.
 * - The wishlist total sums each wishlist product's LOWEST recorded
 *   merchant price. Products with no recorded merchant price are
 *   counted in `unpricedCount` and contribute $0 — never a guessed
 *   price. `target_price` on a wishlist item is the shopper's own
 *   target, not a market price, and is never used as the total.
 */

import type { AnySupabaseClient } from '@/lib/supabase/types';
import { logger } from '@/lib/config/logger';
import { getWishlists, getWishlistItems } from '@/services/wishlists';

/** Defaults match the migration 019 column defaults. */
export const DEFAULT_MONTHLY_TECH_BUDGET_USD = 1000;
export const DEFAULT_DAILY_TARGET_HOURS = 6;

export interface TechBudget {
  monthlyTechBudgetUsd: number;
  dailyTargetHours: number;
  /** True only when a row actually exists for the user. */
  saved: boolean;
}

export interface WishlistOwnershipTotal {
  /** Sum of lowest recorded merchant prices across wishlist products. */
  totalUsd: number;
  /** Distinct wishlist products counted. */
  itemCount: number;
  /** Products that had a recorded merchant price. */
  pricedCount: number;
  /** Products with no recorded merchant price (contribute $0). */
  unpricedCount: number;
}

function sanitizeBudget(value: unknown, fallback: number): number {
  const n = typeof value === 'string' ? Number(value) : (value as number);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Validate user-supplied budget inputs. Non-finite or non-positive
 * values fall back to the defaults — never to a guessed budget.
 */
export function sanitizeTechBudget(input: {
  monthlyTechBudgetUsd?: unknown;
  dailyTargetHours?: unknown;
}): { monthlyTechBudgetUsd: number; dailyTargetHours: number } {
  return {
    monthlyTechBudgetUsd: sanitizeBudget(
      input.monthlyTechBudgetUsd,
      DEFAULT_MONTHLY_TECH_BUDGET_USD
    ),
    dailyTargetHours: sanitizeBudget(
      input.dailyTargetHours,
      DEFAULT_DAILY_TARGET_HOURS
    ),
  };
}

/**
 * Budget vs wishlist-total status. remainingUsd is negative when the
 * wishlist total exceeds the monthly budget. coveragePct is the share
 * of the budget the wishlist total would use (null when budget <= 0).
 */
export function budgetStatus(input: {
  monthlyBudgetUsd: number;
  wishlistTotalUsd: number;
}): { remainingUsd: number; overBudget: boolean; coveragePct: number | null } {
  const budget = Number.isFinite(input.monthlyBudgetUsd) ? input.monthlyBudgetUsd : 0;
  const total = Number.isFinite(input.wishlistTotalUsd) && input.wishlistTotalUsd > 0
    ? input.wishlistTotalUsd
    : 0;
  return {
    remainingUsd: Math.round((budget - total) * 100) / 100,
    overBudget: budget > 0 && total > budget,
    coveragePct: budget > 0 ? Math.round((total / budget) * 100) : null,
  };
}

/**
 * Read the caller's tech budget row. Returns null when no row exists
 * or when the table is missing (migration 019 not run) — never throws.
 */
export async function getTechBudget(
  supabase: AnySupabaseClient,
  userId: string
): Promise<TechBudget | null> {
  try {
    const { data, error } = await supabase
      .from('user_tech_budgets')
      .select('monthly_tech_budget, daily_target_hours')
      .eq('user_id', userId)
      .maybeSingle();
    if (error || !data) {
      if (error) {
        logger.warn('getTechBudget: query failed (019 may not be run)', {
          error: error.message,
        });
      }
      return null;
    }
    const row = data as Record<string, unknown>;
    const clean = sanitizeTechBudget({
      monthlyTechBudgetUsd: row.monthly_tech_budget,
      dailyTargetHours: row.daily_target_hours,
    });
    return { ...clean, saved: true };
  } catch (err) {
    logger.warn('getTechBudget: unexpected error', { error: String(err) });
    return null;
  }
}

/**
 * Upsert the caller's tech budget row. Returns null when the table is
 * missing (migration 019 not run) or the write fails — never throws.
 */
export async function upsertTechBudget(
  supabase: AnySupabaseClient,
  userId: string,
  input: { monthlyTechBudgetUsd?: unknown; dailyTargetHours?: unknown }
): Promise<TechBudget | null> {
  const clean = sanitizeTechBudget(input);
  try {
    const { data, error } = await supabase
      .from('user_tech_budgets')
      .upsert(
        {
          user_id: userId,
          monthly_tech_budget: clean.monthlyTechBudgetUsd,
          daily_target_hours: clean.dailyTargetHours,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' }
      )
      .select('monthly_tech_budget, daily_target_hours')
      .maybeSingle();
    if (error || !data) {
      if (error) {
        logger.warn('upsertTechBudget: write failed (019 may not be run)', {
          error: error.message,
        });
      }
      return null;
    }
    const row = data as Record<string, unknown>;
    return {
      ...sanitizeTechBudget({
        monthlyTechBudgetUsd: row.monthly_tech_budget,
        dailyTargetHours: row.daily_target_hours,
      }),
      saved: true,
    };
  } catch (err) {
    logger.warn('upsertTechBudget: unexpected error', { error: String(err) });
    return null;
  }
}

/**
 * Total ownership cost of the user's wishlist items: the sum of each
 * distinct wishlist product's LOWEST recorded merchant price. Fail-safe
 * — any failure returns zeros, never throws.
 */
export async function getWishlistOwnershipTotal(
  supabase: AnySupabaseClient,
  userId: string
): Promise<WishlistOwnershipTotal> {
  const empty: WishlistOwnershipTotal = {
    totalUsd: 0,
    itemCount: 0,
    pricedCount: 0,
    unpricedCount: 0,
  };
  try {
    const wishlists = await getWishlists(supabase, userId);
    const productIds = new Set<string>();
    for (const wl of wishlists) {
      const items = await getWishlistItems(supabase, wl.id, userId);
      for (const item of items) {
        if (item.productId) productIds.add(item.productId);
      }
    }
    if (productIds.size === 0) return empty;

    const ids = [...productIds];
    const { data, error } = await supabase
      .from('merchant_products')
      .select('product_id, price')
      .in('product_id', ids);
    if (error || !data) {
      if (error) {
        logger.warn('getWishlistOwnershipTotal: prices query failed', {
          error: error.message,
        });
      }
      return { ...empty, itemCount: ids.length, unpricedCount: ids.length };
    }

    const lowestByProduct = new Map<string, number>();
    for (const row of data as Array<Record<string, unknown>>) {
      const pid = row.product_id as string;
      const price = Number(row.price);
      if (!pid || !Number.isFinite(price) || price <= 0) continue;
      const current = lowestByProduct.get(pid);
      if (current === undefined || price < current) lowestByProduct.set(pid, price);
    }

    let totalUsd = 0;
    let pricedCount = 0;
    for (const id of ids) {
      const lowest = lowestByProduct.get(id);
      if (lowest !== undefined) {
        totalUsd += lowest;
        pricedCount += 1;
      }
    }
    return {
      totalUsd: Math.round(totalUsd * 100) / 100,
      itemCount: ids.length,
      pricedCount,
      unpricedCount: ids.length - pricedCount,
    };
  } catch (err) {
    logger.warn('getWishlistOwnershipTotal: unexpected error', { error: String(err) });
    return empty;
  }
}
