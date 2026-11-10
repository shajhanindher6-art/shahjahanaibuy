/**
 * AI Eco Shopping Coach (Section 7, item 15).
 *
 * Monthly carbon budget + a per-purchase coach note + lower-carbon
 * alternatives. Built on lib/sustainability.ts — its recorded-first
 * precedence is reused, never rebuilt:
 * - RECORDED carbon first (migration 020 hardware endurance).
 * - ESTIMATE only when nothing is recorded, always labeled
 *   "Estimate only — not a certified lifecycle assessment".
 * - UNKNOWN when neither exists: no number at all.
 *
 * Lower-carbon alternatives are REAL catalog products with a lower
 * RECORDED carbon footprint in the same category — never estimates,
 * never invented products.
 *
 * Monthly spend is derived from the user's Receipt Vault items
 * bought in that month (recorded purchase price doubles as the
 * estimate input price when no carbon is recorded). Recorded and
 * estimated kilos are always reported separately.
 *
 * All DB reads are fail-safe: a missing table/column (42P01 /
 * PGRST205 / 42703) returns an empty honest state, never a throw.
 */

import { logger } from '@/lib/config/logger';
import type { AnySupabaseClient } from '@/lib/supabase/types';
import { resolveCarbonLabel, type CarbonLabel } from '@/lib/sustainability';
import { getProductEndurance } from '@/services/hardware-endurance';
import { getProductBySlug, getProducts } from '@/services/products';

export const ECO_BUDGET_MIN_KG = 0.01;
export const ECO_BUDGET_MAX_KG = 100_000;
export const ECO_COACH_NEAR_BUDGET_RATIO = 0.8;
export const ECO_ALTERNATIVES_MAX = 3;

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** "YYYY-MM" for the current month (UTC). */
export function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

export function isValidMonth(value: unknown): value is string {
  return typeof value === 'string' && MONTH_RE.test(value);
}

/** A carbon budget in kg CO2e/month, or null when it is not a valid budget. */
export function normalizeBudgetKg(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  if (n < ECO_BUDGET_MIN_KG || n > ECO_BUDGET_MAX_KG) return null;
  return Math.round(n * 100) / 100;
}

export type BudgetStatusKind = 'within' | 'near' | 'over' | 'unknown';

export interface BudgetStatus {
  spentKg: number | null;
  budgetKg: number;
  remainingKg: number | null;
  percentUsed: number | null;
  status: BudgetStatusKind;
}

/**
 * Budget status from spent vs budget. Pure — no I/O. `spentKg`
 * null (no spend data at all) yields status 'unknown', never 0%.
 */
export function budgetStatus(spentKg: number | null, budgetKg: number): BudgetStatus {
  if (spentKg === null || !Number.isFinite(spentKg)) {
    return { spentKg: null, budgetKg, remainingKg: null, percentUsed: null, status: 'unknown' };
  }
  const spent = Math.max(0, Math.round(spentKg * 10) / 10);
  const remaining = Math.round((budgetKg - spent) * 10) / 10;
  const percentUsed = budgetKg > 0 ? Math.round((spent / budgetKg) * 1000) / 10 : null;
  const status: BudgetStatusKind =
    percentUsed === null ? 'unknown' : spent > budgetKg ? 'over' : spent >= budgetKg * ECO_COACH_NEAR_BUDGET_RATIO ? 'near' : 'within';
  return { spentKg: spent, budgetKg, remainingKg: remaining, percentUsed, status };
}

export interface LowerCarbonAlternative {
  slug: string;
  name: string;
  brand: string | null;
  category: string | null;
  /** Recorded carbon only — alternatives are never picked from estimates. */
  recordedKg: number;
  savingKg: number;
}

/**
 * Deterministic coach note for one purchase. Pure — no I/O.
 * Recorded carbon is stated as recorded; an estimate is labeled
 * as an estimate; unknown carbon says so plainly.
 */
export function coachNoteForPurchase(input: {
  productName: string;
  carbon: CarbonLabel;
  budget: BudgetStatus | null;
  alternativesCount: number;
}): string {
  const lines: string[] = [];
  if (input.carbon.kind === 'recorded' && input.carbon.kgCO2e !== null) {
    lines.push(
      `${input.productName} ka recorded carbon footprint ${input.carbon.kgCO2e} kg CO2e hai` +
        (input.carbon.band ? ` (band ${input.carbon.band}).` : '.')
    );
  } else if (input.carbon.kind === 'estimate' && input.carbon.kgCO2e !== null) {
    lines.push(
      `${input.productName} ka carbon estimate ${input.carbon.kgCO2e} kg CO2e hai — Estimate only — not a certified lifecycle assessment.`
    );
  } else {
    lines.push(
      `${input.productName} ke liye koi carbon data recorded nahi hai — is khareedari ka carbon ginna mumkin nahi.`
    );
  }
  const budget = input.budget;
  if (budget && budget.status !== 'unknown' && budget.percentUsed !== null) {
    if (budget.status === 'over') {
      lines.push(
        `Is mahine ka carbon budget (${budget.budgetKg} kg) pehle hi paar ho chuka hai (${budget.percentUsed}% used) — is khareedari ko agle mahine tak rokna behtar hoga.`
      );
    } else if (budget.status === 'near') {
      lines.push(
        `Is mahine ka carbon budget ${budget.percentUsed}% use ho chuka hai (${budget.remainingKg} kg baqi) — is khareedari par dobara ghaur karein.`
      );
    } else {
      lines.push(
        `Is mahine ka carbon budget ${budget.percentUsed}% use hua hai (${budget.remainingKg} kg baqi) — ye khareedari budget ke andar hai.`
      );
    }
  }
  if (input.alternativesCount > 0) {
    lines.push(
      `Is se kam recorded carbon wale ${input.alternativesCount} real options hain — neeche dekhein.`
    );
  }
  return lines.join(' ');
}

// ---------------------------------------------------------------------------
// DB helpers (fail-safe)
// ---------------------------------------------------------------------------

export function isMissingTableError(error: { code?: string } | null | undefined): boolean {
  return error?.code === '42P01' || error?.code === 'PGRST205';
}

export function isMissingColumnError(error: { code?: string } | null | undefined): boolean {
  return error?.code === '42703';
}

export interface EcoBudget {
  id: string;
  user_id: string;
  month: string;
  budget_kg: number;
  created_at: string;
}

/**
 * The user's carbon budget for a month, or null when none was set.
 * `enabled` is false when the eco_budgets table does not exist yet
 * (migration not run). Never throws.
 */
export async function getEcoBudget(
  supabase: AnySupabaseClient,
  userId: string,
  month: string
): Promise<{ budget: EcoBudget | null; enabled: boolean }> {
  try {
    const { data, error } = await supabase
      .from('eco_budgets')
      .select('id, user_id, month, budget_kg, created_at')
      .eq('user_id', userId)
      .eq('month', month)
      .maybeSingle();
    if (error) {
      if (isMissingTableError(error) || isMissingColumnError(error)) {
        return { budget: null, enabled: false };
      }
      logger.warn('getEcoBudget: query failed', { error: error.message });
      return { budget: null, enabled: true };
    }
    if (!data) return { budget: null, enabled: true };
    const row = data as EcoBudget;
    const kg = typeof row.budget_kg === 'number' ? row.budget_kg : Number(row.budget_kg);
    if (!Number.isFinite(kg)) return { budget: null, enabled: true };
    return { budget: { ...row, budget_kg: kg }, enabled: true };
  } catch (err) {
    logger.warn('getEcoBudget: unexpected error', { error: String(err) });
    return { budget: null, enabled: true };
  }
}

/**
 * Save (insert or update) the user's carbon budget for a month.
 * UNIQUE(user_id, month) makes this an upsert. Returns
 * missingTable when the migration has not been run. Never throws.
 */
export async function saveEcoBudget(
  supabase: AnySupabaseClient,
  userId: string,
  month: string,
  budgetKg: number
): Promise<
  | { budget: EcoBudget; deduped: boolean }
  | { error: { code?: string; message: string }; missingTable?: boolean }
> {
  try {
    const { data: existing, error: existingError } = await supabase
      .from('eco_budgets')
      .select('id, user_id, month, budget_kg, created_at')
      .eq('user_id', userId)
      .eq('month', month)
      .maybeSingle();
    if (existingError) {
      if (isMissingTableError(existingError) || isMissingColumnError(existingError)) {
        return { error: { code: existingError.code, message: 'Carbon budgets are not set up yet.' }, missingTable: true };
      }
      return { error: { code: existingError.code, message: 'Failed to read carbon budgets' } };
    }
    if (existing) {
      const { data, error } = await supabase
        .from('eco_budgets')
        .update({ budget_kg: budgetKg })
        .eq('id', (existing as EcoBudget).id)
        .eq('user_id', userId)
        .select('id, user_id, month, budget_kg, created_at')
        .single();
      if (error || !data) {
        return { error: { code: error?.code, message: 'Failed to update the carbon budget' } };
      }
      return { budget: data as EcoBudget, deduped: true };
    }
    const { data, error } = await supabase
      .from('eco_budgets')
      .insert({ user_id: userId, month, budget_kg: budgetKg })
      .select('id, user_id, month, budget_kg, created_at')
      .single();
    if (error || !data) {
      if (isMissingTableError(error) || isMissingColumnError(error)) {
        return { error: { code: error?.code, message: 'Carbon budgets are not set up yet.' }, missingTable: true };
      }
      return { error: { code: error?.code, message: 'Failed to save the carbon budget' } };
    }
    return { budget: data as EcoBudget, deduped: false };
  } catch (err) {
    logger.warn('saveEcoBudget: unexpected error', { error: String(err) });
    return { error: { message: 'Failed to save the carbon budget' } };
  }
}

export interface MonthlyCarbonSpend {
  month: string;
  /** Sum of RECORDED carbon for the month's vault purchases. */
  recordedKg: number;
  /** Sum of ESTIMATES (labeled) for purchases with no recorded carbon. */
  estimatedKg: number;
  /** recorded + estimated — the total the budget is judged against. */
  totalKg: number;
  /** Vault purchases in the month. */
  purchaseCount: number;
  /** Purchases with recorded carbon. */
  recordedCount: number;
  /** Purchases counted by estimate only. */
  estimatedCount: number;
  /** Purchases with no carbon data at all (not counted in totalKg). */
  unknownCount: number;
  /** True when any part of totalKg is an estimate. */
  hasEstimates: boolean;
  /** False when the vault table itself is missing. */
  vaultEnabled: boolean;
}

function monthBounds(month: string): { start: string; end: string } {
  const [y, m] = month.split('-').map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { start: `${month}-01`, end: `${month}-${String(lastDay).padStart(2, '0')}` };
}

/**
 * The month's carbon spend, derived from the user's Receipt Vault
 * purchases in that month. Recorded carbon first; the recorded
 * purchase amount feeds the Option 8 estimate only when nothing is
 * recorded; purchases with neither are counted as unknown and add
 * nothing to the total. Never throws.
 */
export async function getMonthlyCarbonSpend(
  supabase: AnySupabaseClient,
  userId: string,
  month: string
): Promise<MonthlyCarbonSpend> {
  const empty: MonthlyCarbonSpend = {
    month,
    recordedKg: 0,
    estimatedKg: 0,
    totalKg: 0,
    purchaseCount: 0,
    recordedCount: 0,
    estimatedCount: 0,
    unknownCount: 0,
    hasEstimates: false,
    vaultEnabled: true,
  };
  try {
    const { start, end } = monthBounds(month);
    const { data, error } = await supabase
      .from('vault_items')
      .select('id, product_id, purchase_date, amount')
      .eq('user_id', userId)
      .gte('purchase_date', start)
      .lte('purchase_date', end);
    if (error) {
      if (isMissingTableError(error) || isMissingColumnError(error)) {
        return { ...empty, vaultEnabled: false };
      }
      logger.warn('getMonthlyCarbonSpend: query failed', { error: error.message });
      return empty;
    }
    const items = (data ?? []) as Array<{
      id: string;
      product_id: string | null;
      purchase_date: string;
      amount: number | null;
    }>;
    if (items.length === 0) return empty;
    const productIds = [...new Set(items.map((i) => i.product_id).filter((p): p is string => p !== null))];
    const categoryById = new Map<string, string | null>();
    if (productIds.length > 0) {
      const { data: products } = await supabase
        .from('products')
        .select('id, category')
        .in('id', productIds);
      for (const p of (products ?? []) as Array<{ id: string; category: string | null }>) {
        categoryById.set(p.id, p.category);
      }
    }
    const out = { ...empty, purchaseCount: items.length };
    for (const item of items) {
      if (!item.product_id) {
        out.unknownCount += 1;
        continue;
      }
      const endurance = await getProductEndurance(supabase, item.product_id);
      const label = resolveCarbonLabel({
        recordedKg: endurance.carbonFootprintKg,
        category: categoryById.get(item.product_id) ?? null,
        priceUsd:
          typeof item.amount === 'number' && Number.isFinite(item.amount) ? item.amount : null,
      });
      if (label.kind === 'recorded' && label.kgCO2e !== null) {
        out.recordedKg = Math.round((out.recordedKg + label.kgCO2e) * 10) / 10;
        out.recordedCount += 1;
      } else if (label.kind === 'estimate' && label.kgCO2e !== null) {
        out.estimatedKg = Math.round((out.estimatedKg + label.kgCO2e) * 10) / 10;
        out.estimatedCount += 1;
      } else {
        out.unknownCount += 1;
      }
    }
    out.totalKg = Math.round((out.recordedKg + out.estimatedKg) * 10) / 10;
    out.hasEstimates = out.estimatedCount > 0;
    return out;
  } catch (err) {
    logger.warn('getMonthlyCarbonSpend: unexpected error', { error: String(err) });
    return empty;
  }
}

/** Lowest recorded merchant price for a product (estimate input), or null. */
export async function getLowestRecordedPrice(
  supabase: AnySupabaseClient,
  productId: string
): Promise<number | null> {
  try {
    const { data, error } = await supabase
      .from('merchant_products')
      .select('price')
      .eq('product_id', productId)
      .is('deleted_at', null)
      .order('price', { ascending: true })
      .limit(1);
    if (error || !data || data.length === 0) return null;
    const price = Number((data[0] as { price: unknown }).price);
    return Number.isFinite(price) && price > 0 ? price : null;
  } catch {
    return null;
  }
}

export interface CoachNoteResult {
  productSlug: string;
  productName: string;
  category: string | null;
  carbon: CarbonLabel;
  alternatives: LowerCarbonAlternative[];
  note: string;
  /** Why no alternatives were found (null when alternatives exist). */
  alternativesNote: string | null;
}

/**
 * Full per-purchase coach note for a product slug: carbon label
 * (recorded-first via lib/sustainability.ts), lower-carbon
 * alternatives (recorded only), and the deterministic note. The
 * budget is judged only when the caller passes one. Never throws;
 * returns null when the product slug is not in the catalog.
 */
export async function getCoachNoteForProduct(
  supabase: AnySupabaseClient,
  productSlug: string,
  budget: BudgetStatus | null
): Promise<CoachNoteResult | null> {
  try {
    const product = await getProductBySlug(supabase, productSlug);
    if (!product) return null;
    const [endurance, lowestPrice] = await Promise.all([
      getProductEndurance(supabase, product.id),
      getLowestRecordedPrice(supabase, product.id),
    ]);
    const carbon = resolveCarbonLabel({
      recordedKg: endurance.carbonFootprintKg,
      category: product.category,
      priceUsd: lowestPrice,
    });

    let alternatives: LowerCarbonAlternative[] = [];
    let alternativesNote: string | null = null;
    if (carbon.kind === 'recorded' && carbon.kgCO2e !== null) {
      const base = carbon.kgCO2e;
      const { products } = await getProducts(supabase, {
        category: product.category ?? undefined,
        pageSize: 100,
      });
      const found: LowerCarbonAlternative[] = [];
      for (const candidate of products) {
        if (candidate.id === product.id) continue;
        const candEndurance = await getProductEndurance(supabase, candidate.id);
        const recorded = candEndurance.carbonFootprintKg;
        if (recorded === null || !Number.isFinite(recorded) || recorded >= base) continue;
        found.push({
          slug: candidate.slug,
          name: candidate.name,
          brand: candidate.brand,
          category: candidate.category,
          recordedKg: recorded,
          savingKg: Math.round((base - recorded) * 10) / 10,
        });
      }
      found.sort((a, b) => a.recordedKg - b.recordedKg);
      alternatives = found.slice(0, ECO_ALTERNATIVES_MAX);
      if (alternatives.length === 0) {
        alternativesNote =
          'Is category mein is se kam recorded carbon wala koi aur real product nahi mila.';
      }
    } else {
      alternativesNote =
        'Is product ka recorded carbon nahi hai, is liye kam-carbon alternatives recorded data se compare nahi kiye ja sakte.';
    }

    const note = coachNoteForPurchase({
      productName: product.name,
      carbon,
      budget,
      alternativesCount: alternatives.length,
    });
    return {
      productSlug: product.slug,
      productName: product.name,
      category: product.category,
      carbon,
      alternatives,
      note,
      alternativesNote,
    };
  } catch (err) {
    logger.warn('getCoachNoteForProduct: unexpected error', { error: String(err) });
    return null;
  }
}
