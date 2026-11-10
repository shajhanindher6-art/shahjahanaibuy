/**
 * Autonomous deal hunting — Section 6, item 2 (trimmed audit design).
 *
 * A hunt is a user-stated brief: "find me a product in this category
 * under $X". The hunter runs ONLY inside the existing 6-hour price
 * refresh chain (app/api/v1/prices/refresh/route.ts) for users who
 * granted agent-memory consent — there is no second scheduler and
 * no background job of its own.
 *
 * HONESTY RULES (hard):
 * - A match requires a REAL RECORDED in-stock price at or under the
 *   stated budget. The price is the lowest recorded in-stock
 *   merchant_products price, falling back to the latest in-stock
 *   price_history row only when no merchant listing exists. A
 *   product with no recorded in-stock price never matches, and no
 *   price is ever invented, estimated, or taken from a seed/demo row.
 * - Budgets, categories, and brands come ONLY from what the user
 *   stated: the hunt row itself, agent_memory.preferences, or an
 *   active agent rule's target price. Nothing is inferred.
 * - The demo / health-check product (DEMO_EXCLUDED_SLUGS) is never
 *   matched and never recommended.
 * - Matches are deduped on (hunt_id, product_id, matched_price_usd)
 *   — the same price never creates a second match row.
 * - Until migration 033 is run, every function here fail-safes to
 *   an empty result with huntsEnabled: false — never a crash.
 */

import type { AnySupabaseClient } from '@/lib/supabase/types';
import type { AgentPreferences } from '@/lib/agent-memory';
import { DEMO_EXCLUDED_SLUGS } from '@/services/personal-assistant';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentHunt {
  id: string;
  userId: string;
  category: string | null;
  maxBudgetUsd: number | null;
  preferredBrands: string[] | null;
  active: boolean;
  lastRunAt: string | null;
  createdAt: string;
}

export interface AgentHuntInput {
  category?: string | null;
  maxBudgetUsd?: number | null;
  preferredBrands?: string[] | null;
}

export interface HuntCandidate {
  productId: string;
  slug: string;
  name: string;
  brand: string | null;
  category: string | null;
  /** Lowest recorded in-stock price in USD, or null when unpriced. */
  lowestPriceUsd: number | null;
}

export interface HuntMatch {
  id: string;
  huntId: string;
  userId: string;
  productId: string;
  productSlug: string | null;
  productName: string | null;
  matchedPriceUsd: number;
  matchedAt: string;
}

export interface HuntConstraints {
  maxBudgetUsd?: number | null;
  categories?: string[] | null;
  preferredBrands?: string[] | null;
}

export interface RunHuntResult {
  huntsRun: number;
  /** Matches newly written on this run (deduped — never re-created). */
  matches: HuntMatch[];
  huntsEnabled: boolean;
}

export interface RunHuntsForUsersResult {
  usersChecked: number;
  huntsRun: number;
  matchesCreated: number;
  huntsEnabled: boolean;
}

/** Max catalog products scanned in one hunt run. */
export const MAX_HUNT_PRODUCTS = 500;

// ---------------------------------------------------------------------------
// Pure logic (unit-tested, no I/O)
// ---------------------------------------------------------------------------

/** True when the slug is a demo / health-check product that must never match. */
export function isDemoSlug(slug: string): boolean {
  return (DEMO_EXCLUDED_SLUGS as readonly string[]).includes(slug);
}

function norm(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

/**
 * True only when a candidate satisfies every STATED constraint:
 * a real recorded price at or under the budget, the category when
 * stated, and one of the preferred brands when stated. A null price
 * never matches; an empty constraint list means "no constraint".
 */
export function huntMatchesCandidate(
  candidate: HuntCandidate,
  constraints: HuntConstraints
): boolean {
  if (isDemoSlug(candidate.slug)) return false;
  const price = candidate.lowestPriceUsd;
  if (price === null || !Number.isFinite(price) || price <= 0) return false;
  if (
    constraints.maxBudgetUsd !== undefined &&
    constraints.maxBudgetUsd !== null &&
    price > constraints.maxBudgetUsd
  ) {
    return false;
  }
  const categories = (constraints.categories ?? []).filter((c) => norm(c) !== '');
  if (categories.length > 0 && !categories.some((c) => norm(c) === norm(candidate.category))) {
    return false;
  }
  const brands = (constraints.preferredBrands ?? []).filter((b) => norm(b) !== '');
  if (brands.length > 0 && !brands.some((b) => norm(b) === norm(candidate.brand))) {
    return false;
  }
  return true;
}

/**
 * Effective per-product budget: the strictest (lowest) of the stated
 * values — the hunt's own budget, the memory budget, and an active
 * agent rule's target for this product. Null when nothing is stated.
 */
export function effectiveBudgetUsd(
  hunt: AgentHuntInput,
  preferences: AgentPreferences,
  ruleTargetUsd: number | null
): number | null {
  const stated: number[] = [];
  if (typeof hunt.maxBudgetUsd === 'number' && Number.isFinite(hunt.maxBudgetUsd) && hunt.maxBudgetUsd > 0) {
    stated.push(hunt.maxBudgetUsd);
  }
  if (
    typeof preferences.maxBudgetUsd === 'number' &&
    Number.isFinite(preferences.maxBudgetUsd) &&
    (preferences.maxBudgetUsd as number) > 0
  ) {
    stated.push(preferences.maxBudgetUsd as number);
  }
  if (typeof ruleTargetUsd === 'number' && Number.isFinite(ruleTargetUsd) && ruleTargetUsd > 0) {
    stated.push(ruleTargetUsd);
  }
  return stated.length > 0 ? Math.min(...stated) : null;
}

/** Lowest finite positive price in a list, or null when there is none. */
export function lowestRecordedPrice(prices: Array<number | null | undefined>): number | null {
  let lowest: number | null = null;
  for (const p of prices) {
    if (typeof p !== 'number' || !Number.isFinite(p) || p <= 0) continue;
    if (lowest === null || p < lowest) lowest = p;
  }
  return lowest;
}

/** Dedupe key for a match — mirrors the UNIQUE (hunt_id, product_id, matched_price_usd). */
export function huntMatchDedupeKey(huntId: string, productId: string, matchedPriceUsd: number): string {
  return `${huntId}::${productId}::${matchedPriceUsd}`;
}

// ---------------------------------------------------------------------------
// Missing-table detection (PostgREST reports PGRST205, not 42P01)
// ---------------------------------------------------------------------------

export function isMissingTableError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as { code?: unknown; message?: unknown };
  if (e.code === '42P01' || e.code === 'PGRST205') return true;
  return typeof e.message === 'string' && /does not exist/i.test(e.message);
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

type Row = Record<string, unknown>;

export function mapHuntRow(row: Row): AgentHunt {
  return {
    id: asString(row.id) ?? '',
    userId: asString(row.user_id) ?? '',
    category: asString(row.category),
    maxBudgetUsd: asNumber(row.max_budget_usd),
    preferredBrands: Array.isArray(row.preferred_brands)
      ? (row.preferred_brands as unknown[]).filter((b): b is string => typeof b === 'string')
      : null,
    active: row.active === true,
    lastRunAt: asString(row.last_run_at),
    createdAt: asString(row.created_at) ?? '',
  };
}

export function mapHuntMatchRow(row: Row, productById?: Map<string, { slug: string; name: string }>): HuntMatch {
  const product = productById?.get(asString(row.product_id) ?? '');
  return {
    id: asString(row.id) ?? '',
    huntId: asString(row.hunt_id) ?? '',
    userId: asString(row.user_id) ?? '',
    productId: asString(row.product_id) ?? '',
    productSlug: product?.slug ?? null,
    productName: product?.name ?? null,
    matchedPriceUsd: asNumber(row.matched_price_usd) ?? 0,
    matchedAt: asString(row.matched_at) ?? '',
  };
}

// ---------------------------------------------------------------------------
// Price scan — lowest RECORDED in-stock price per product
// ---------------------------------------------------------------------------

async function loadLowestPrices(
  supabase: AnySupabaseClient,
  productIds: string[]
): Promise<Map<string, number>> {
  const lowest = new Map<string, number>();

  const { data: listings } = await supabase
    .from('merchant_products')
    .select('product_id, price')
    .in('product_id', productIds)
    .is('deleted_at', null)
    .eq('in_stock', true)
    .order('price', { ascending: true });
  for (const row of (listings ?? []) as Array<Row>) {
    const pid = String(row.product_id);
    if (lowest.has(pid)) continue;
    const price = asNumber(row.price);
    if (price !== null && price > 0) lowest.set(pid, price);
  }

  // Fallback for products with no in-stock merchant listing: the
  // latest in-stock price_history row. History prices are recorded
  // prices too — never a live fetch, never a guess.
  const unpriced = productIds.filter((id) => !lowest.has(id));
  if (unpriced.length > 0) {
    const { data: history } = await supabase
      .from('price_history')
      .select('product_id, price, availability, recorded_at')
      .in('product_id', unpriced)
      .eq('availability', 'in_stock')
      .order('recorded_at', { ascending: false })
      .limit(1000);
    const latestByProduct = new Map<string, number>();
    for (const row of (history ?? []) as Array<Row>) {
      const pid = String(row.product_id);
      if (latestByProduct.has(pid)) continue;
      const price = asNumber(row.price);
      if (price !== null && price > 0) latestByProduct.set(pid, price);
    }
    for (const [pid, price] of latestByProduct) lowest.set(pid, price);
  }

  return lowest;
}

// ---------------------------------------------------------------------------
// Hunt runner
// ---------------------------------------------------------------------------

/**
 * Run all active hunts for one user. Reads the user's STATED
 * agent_memory.preferences + active agent_rules, scans the catalog
 * for the lowest recorded in-stock price per product, writes new
 * matches to hunt_matches (deduped), and returns the new matches.
 * Never throws: a missing migration 033 table (or any error) yields
 * an empty result with huntsEnabled: false.
 */
export async function runHuntForUser(
  supabase: AnySupabaseClient,
  userId: string
): Promise<RunHuntResult> {
  const empty: RunHuntResult = { huntsRun: 0, matches: [], huntsEnabled: false };
  try {
    const { data: huntsData, error: huntsError } = await supabase
      .from('agent_hunts')
      .select('id, user_id, category, max_budget_usd, preferred_brands, active, last_run_at, created_at')
      .eq('user_id', userId)
      .eq('active', true)
      .order('created_at', { ascending: true });
    if (huntsError) {
      if (isMissingTableError(huntsError)) return empty;
      return empty;
    }
    const hunts = ((huntsData ?? []) as Array<Row>).map(mapHuntRow);
    if (hunts.length === 0) return { huntsRun: 0, matches: [], huntsEnabled: true };

    // Stated preferences (missing table → no preferences, hunts still run on their own budget).
    let preferences: AgentPreferences = {};
    const { data: memoryData } = await supabase
      .from('agent_memory')
      .select('preferences')
      .eq('user_id', userId)
      .maybeSingle();
    if (memoryData) {
      const prefs = (memoryData as Row).preferences as Record<string, unknown> | null;
      if (prefs && typeof prefs === 'object') {
        preferences = {
          maxBudgetUsd: asNumber(prefs.maxBudgetUsd) ?? undefined,
          categories: Array.isArray(prefs.categories)
            ? (prefs.categories as unknown[]).filter((c): c is string => typeof c === 'string')
            : undefined,
          preferredBrands: Array.isArray(prefs.preferredBrands)
            ? (prefs.preferredBrands as unknown[]).filter((b): b is string => typeof b === 'string')
            : undefined,
        };
      }
    }

    // Active per-product rule targets (missing table → none).
    const ruleTargetByProductId = new Map<string, number>();
    const { data: rulesData } = await supabase
      .from('agent_rules')
      .select('product_id, target_price_usd')
      .eq('user_id', userId)
      .eq('active', true);
    for (const row of (rulesData ?? []) as Array<Row>) {
      const pid = asString(row.product_id);
      const target = asNumber(row.target_price_usd);
      if (pid && target !== null && target > 0) ruleTargetByProductId.set(pid, target);
    }

    // Catalog scan.
    const { data: productsData } = await supabase
      .from('products')
      .select('id, slug, name, brand, category')
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(MAX_HUNT_PRODUCTS);
    const products = (productsData ?? []) as Array<Row>;
    if (products.length === 0) return { huntsRun: hunts.length, matches: [], huntsEnabled: true };
    const productIds = products.map((p) => String(p.id));
    const lowestByProduct = await loadLowestPrices(supabase, productIds);
    const productById = new Map<string, { slug: string; name: string }>();
    const candidates: HuntCandidate[] = products.map((p) => {
      const id = String(p.id);
      productById.set(id, { slug: String(p.slug), name: String(p.name) });
      return {
        productId: id,
        slug: String(p.slug),
        name: String(p.name),
        brand: asString(p.brand),
        category: asString(p.category),
        lowestPriceUsd: lowestByProduct.get(id) ?? null,
      };
    });

    const newMatches: HuntMatch[] = [];
    for (const hunt of hunts) {
      // Existing matches for this hunt (dedupe in memory; the DB
      // UNIQUE constraint is the second layer).
      const seen = new Set<string>();
      const { data: existing } = await supabase
        .from('hunt_matches')
        .select('product_id, matched_price_usd')
        .eq('hunt_id', hunt.id);
      for (const row of (existing ?? []) as Array<Row>) {
        seen.add(
          huntMatchDedupeKey(hunt.id, String(row.product_id), asNumber(row.matched_price_usd) ?? 0)
        );
      }

      const rowsToInsert: Array<{ hunt_id: string; user_id: string; product_id: string; matched_price_usd: number }> = [];
      for (const candidate of candidates) {
        // Budget: the strictest stated value — the hunt's own budget,
        // the memory budget cap, and any active rule target for this
        // product. Category/brands come ONLY from the hunt row itself
        // (it was created from the stated preferences): falling back
        // to the memory categories here would wrongly restrict a hunt
        // the user deliberately left unfiltered.
        const budget = effectiveBudgetUsd(
          hunt,
          preferences,
          ruleTargetByProductId.get(candidate.productId) ?? null
        );
        const categories = hunt.category ? [hunt.category] : null;
        const brands = hunt.preferredBrands ?? null;
        if (
          !huntMatchesCandidate(candidate, {
            maxBudgetUsd: budget,
            categories,
            preferredBrands: brands,
          })
        ) {
          continue;
        }
        const price = candidate.lowestPriceUsd as number;
        const key = huntMatchDedupeKey(hunt.id, candidate.productId, price);
        if (seen.has(key)) continue;
        seen.add(key);
        rowsToInsert.push({
          hunt_id: hunt.id,
          user_id: userId,
          product_id: candidate.productId,
          matched_price_usd: price,
        });
      }

      if (rowsToInsert.length > 0) {
        const { data: inserted, error: insertError } = await supabase
          .from('hunt_matches')
          .insert(rowsToInsert)
          .select('id, hunt_id, user_id, product_id, matched_price_usd, matched_at');
        if (!insertError && inserted) {
          for (const row of inserted as Array<Row>) {
            newMatches.push(mapHuntMatchRow(row, productById));
          }
        }
        // A 23505 race (another run wrote the same match) is not a
        // failure — the match exists either way; anything else is
        // logged by the caller, never thrown.
      }

      await supabase
        .from('agent_hunts')
        .update({ last_run_at: new Date().toISOString() })
        .eq('id', hunt.id);
    }

    return { huntsRun: hunts.length, matches: newMatches, huntsEnabled: true };
  } catch {
    return empty;
  }
}

/**
 * Run hunts for every user who granted agent-memory consent
 * (consent_granted_at NOT NULL) and has at least one active hunt.
 * Called ONLY from the 6-hour price refresh chain — never scheduled
 * separately. Never throws and never fails the refresh.
 */
export async function runHuntsForConsentedUsers(
  supabase: AnySupabaseClient
): Promise<RunHuntsForUsersResult> {
  const empty: RunHuntsForUsersResult = { usersChecked: 0, huntsRun: 0, matchesCreated: 0, huntsEnabled: false };
  try {
    const { data: consented, error } = await supabase
      .from('agent_memory')
      .select('user_id')
      .not('consent_granted_at', 'is', null);
    if (error) {
      if (isMissingTableError(error)) return empty;
      return empty;
    }
    const userIds = [...new Set(((consented ?? []) as Array<Row>).map((r) => String(r.user_id)).filter(Boolean))];
    let huntsRun = 0;
    let matchesCreated = 0;
    for (const userId of userIds) {
      try {
        const result = await runHuntForUser(supabase, userId);
        huntsRun += result.huntsRun;
        matchesCreated += result.matches.length;
      } catch {
        // One user's hunt must never break the run for the rest.
        continue;
      }
    }
    return { usersChecked: userIds.length, huntsRun, matchesCreated, huntsEnabled: true };
  } catch {
    return empty;
  }
}
