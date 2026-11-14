/**
 * Potential-savings computation (Section 19, Phase 4, §12 #36).
 *
 * Until now the only saving anywhere was the merchant compare-at
 * `savingPct` (lib/deal-math.ts `discountPercent`): "this product is
 * X% off its own was-price". Nothing ever answered "how much do I
 * save by choosing Y instead of X?" or "how much of my budget is
 * left if I buy this?". These pure helpers answer both, from
 * recorded prices only — every input is a real recorded price or a
 * user-stated budget, and every result is null when the inputs
 * needed for it do not exist. No saving is ever invented.
 *
 * All amounts are USD, rounded to cents.
 */

import { discountPercent } from '@/lib/deal-math';

function roundCents(n: number): number {
  return Math.round(n * 100) / 100;
}

function validPrice(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0;
}

/** Saving from choosing the alternative instead of the current pick. */
export interface SavingsVsAlternative {
  /** Dollars saved by choosing the alternative (positive = cheaper). */
  savedUsd: number;
  /** Saving as a % of the current pick's price. */
  savedPct: number;
  /** True when the alternative is NOT cheaper (saving <= 0). */
  alternativeIsMoreExpensive: boolean;
}

/**
 * Compare two recorded prices. Returns null when either price is
 * missing/unpriced — a saving against an unknown price would be
 * invented. A negative saving (alternative costs more) is returned
 * honestly, flagged, never clamped to zero.
 */
export function savingsVsAlternative(
  currentPriceUsd: number | null | undefined,
  alternativePriceUsd: number | null | undefined
): SavingsVsAlternative | null {
  if (!validPrice(currentPriceUsd) || !validPrice(alternativePriceUsd)) return null;
  const savedUsd = roundCents(currentPriceUsd - alternativePriceUsd);
  return {
    savedUsd,
    // S2-5 — NAMED DIFFERENT QUANTITY: a CROSS-PRODUCT saving
    // (alternative vs current pick, denominator = the current
    // pick's price), NOT the merchant-basis discountPercent
    // (compare-at vs price of the SAME product). Same 1-decimal
    // rounding rule, different meaning — never read one as the
    // other.
    savedPct: Math.round((savedUsd / currentPriceUsd) * 1000) / 10,
    alternativeIsMoreExpensive: savedUsd <= 0,
  };
}

/** Saving of one price against a merchant compare-at price. */
export interface SavingsVsCompareAt {
  savedUsd: number;
  savedPct: number;
}

/**
 * Dollars + % saved vs the recorded compare-at (was) price. Null
 * when there is no compare-at price, or it is not above the price —
 * the same honesty rule as `discountPercent` (lib/deal-math.ts).
 */
export function savingsVsCompareAt(
  priceUsd: number | null | undefined,
  compareAtUsd: number | null | undefined
): SavingsVsCompareAt | null {
  if (!validPrice(priceUsd) || !validPrice(compareAtUsd)) return null;
  if (compareAtUsd <= priceUsd) return null;
  return {
    savedUsd: roundCents(compareAtUsd - priceUsd),
    // S2-5: savedPct IS the canonical merchant-basis derivation
    // (lib/deal-math.ts discountPercent) — the inline formula it
    // replaced was identical, so this is a routing change only.
    savedPct: discountPercent(priceUsd, compareAtUsd) as number,
  };
}

/** How one price sits against the user's budget. */
export interface SavingsVsBudget {
  /** Budget minus price: positive = money left over, negative = over budget. */
  remainingUsd: number;
  /** True when the price exceeds the budget. */
  overBudget: boolean;
  /** Dollars over the budget (0 when within budget). */
  overByUsd: number;
  /** Share of the budget the price would use, % (null when budget <= 0). */
  budgetUsedPct: number | null;
}

/**
 * Price vs budget. Returns null when either side is missing — a
 * budget comparison without a budget (or without a price) is not a
 * number, it is a guess. Over-budget is reported as a negative
 * remaining amount plus an explicit `overByUsd`, never hidden.
 */
export function savingsVsBudget(
  priceUsd: number | null | undefined,
  budgetUsd: number | null | undefined
): SavingsVsBudget | null {
  if (!validPrice(priceUsd)) return null;
  if (typeof budgetUsd !== 'number' || !Number.isFinite(budgetUsd) || budgetUsd <= 0) return null;
  const remainingUsd = roundCents(budgetUsd - priceUsd);
  return {
    remainingUsd,
    overBudget: remainingUsd < 0,
    overByUsd: remainingUsd < 0 ? roundCents(-remainingUsd) : 0,
    budgetUsedPct: Math.round((priceUsd / budgetUsd) * 1000) / 10,
  };
}

/**
 * One honest sentence for a pick, built only from the numbers that
 * exist. Parts that have no data are omitted, never filled in:
 * - "Save $100.00 (10%) vs the $1,099.00 was-price"
 * - "· $200.00 left of your $1,000.00 budget"
 * - "· $50.00 over your $950.00 budget"
 * Returns null when there is nothing true to say.
 */
export function describePotentialSavings(input: {
  priceUsd: number | null | undefined;
  compareAtUsd?: number | null | undefined;
  budgetUsd?: number | null | undefined;
  alternativePriceUsd?: number | null | undefined;
  alternativeName?: string | null;
}): string | null {
  const parts: string[] = [];
  const vsCompareAt = savingsVsCompareAt(input.priceUsd, input.compareAtUsd);
  if (vsCompareAt) {
    parts.push(
      `Save $${vsCompareAt.savedUsd.toFixed(2)} (${vsCompareAt.savedPct}%) vs the $${(input.compareAtUsd as number).toFixed(2)} was-price`
    );
  }
  if (input.alternativePriceUsd !== undefined && input.alternativePriceUsd !== null) {
    const vsAlt = savingsVsAlternative(input.priceUsd, input.alternativePriceUsd);
    if (vsAlt && !vsAlt.alternativeIsMoreExpensive) {
      parts.push(
        `Save $${vsAlt.savedUsd.toFixed(2)} by choosing ${input.alternativeName ?? 'the cheaper alternative'} instead`
      );
    }
  }
  const vsBudget = savingsVsBudget(input.priceUsd, input.budgetUsd);
  if (vsBudget) {
    if (vsBudget.overBudget) {
      parts.push(
        `$${vsBudget.overByUsd.toFixed(2)} over your $${(input.budgetUsd as number).toFixed(2)} budget`
      );
    } else {
      parts.push(
        `$${vsBudget.remainingUsd.toFixed(2)} left of your $${(input.budgetUsd as number).toFixed(2)} budget`
      );
    }
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}
