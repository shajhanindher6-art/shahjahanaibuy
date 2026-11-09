/**
 * Impulse-Buy Regret Risk Index (Option 16, Step 2).
 *
 * Deterministic, no LLM, no fetch, no scraping. Pure math over the
 * product's real price, the shopper's own monthly tech budget, and a
 * spec-overkill score that is either derived from recorded specs or
 * explicitly 0 with an "unassessed" flag — never invented.
 *
 *   Regret Score = min(100, round((Price / Budget) * 40 + SpecOverkill + 15))
 *
 * Categories: 0–39 "Low Regret Risk" (green), 40–69 "Moderate Risk"
 * (yellow), 70–100 "High Regret Risk" (red). A null result means the
 * risk cannot be calculated (no recorded price, or no usable budget) —
 * the UI must say so, never show a number from nothing.
 *
 * SpecOverkill (0–25) measures paying for capability beyond the
 * shopper's own stated needs level:
 *   needs basic + specs pro = 25, needs basic + specs balanced = 10,
 *   needs balanced + specs pro = 15, anything at/below needs = 0.
 * When no specs are recorded the overkill is null (not assessed) and
 * the caller must pass 0 and flag it — the score then reflects price
 * vs budget only, and the UI must say overkill was not assessed.
 */

export type NeedsLevel = 'basic' | 'balanced' | 'pro';
export type SpecTier = 'basic' | 'balanced' | 'pro';
export type RegretCategory = 'low' | 'moderate' | 'high';

export interface RegretRiskInput {
  /** Real recorded price in USD, or null when not recorded. */
  priceUsd: number | null;
  /** Shopper's monthly tech budget in USD, or null when unset. */
  monthlyBudgetUsd: number | null;
  /** Spec-overkill points 0–25 (0 when unassessed). */
  specOverkillPoints: number;
  /** True when no specs were recorded, so overkill could not be assessed. */
  overkillUnassessed?: boolean;
}

export interface RegretRiskResult {
  score: number;
  category: RegretCategory;
  label: string;
  advice: string;
  /** Price as a multiple of the monthly budget (e.g. 1.0 = one month). */
  priceToBudgetRatio: number;
  /** True when the overkill part could not be assessed (no specs). */
  overkillUnassessed: boolean;
}

export const REGRET_CATEGORY_LABELS: Record<RegretCategory, string> = {
  low: 'Low Regret Risk',
  moderate: 'Moderate Risk',
  high: 'High Regret Risk',
};

/**
 * Spec-overkill points for a needs level vs the product's spec tier.
 * Returns null when the spec tier is unknown (no specs recorded) —
 * the caller passes 0 for the score and flags it as unassessed.
 */
export function specOverkillPoints(input: {
  needsLevel: NeedsLevel;
  specTier: SpecTier | null;
}): number | null {
  if (!input.specTier) return null;
  const rank: Record<SpecTier, number> = { basic: 0, balanced: 1, pro: 2 };
  const gap = rank[input.specTier] - rank[input.needsLevel];
  if (gap <= 0) return 0;
  if (gap === 1) return input.needsLevel === 'basic' ? 10 : 15;
  return 25;
}

function categoryForScore(score: number): RegretCategory {
  if (score >= 70) return 'high';
  if (score >= 40) return 'moderate';
  return 'low';
}

function adviceFor(input: {
  category: RegretCategory;
  ratio: number;
  overkill: number;
  overkillUnassessed: boolean;
}): string {
  const { category, ratio, overkill, overkillUnassessed } = input;
  if (category === 'low') {
    return overkillUnassessed
      ? `Fits budget well — the price is about ${ratio.toFixed(1)}× your monthly tech budget. Spec overkill could not be checked (no specs recorded).`
      : `Fits budget well — the price is about ${ratio.toFixed(1)}× your monthly tech budget, and the specs match what you need.`;
  }
  if (category === 'moderate') {
    if (overkill > 0) {
      return 'Worth a second look — you may be paying for specs you will rarely use. Check the Spec Trade-offs before buying.';
    }
    return `Worth a second look — the price is about ${ratio.toFixed(1)}× your monthly tech budget. Sleep on it before buying.`;
  }
  if (overkill > 0) {
    return 'Overpaying for unused specs — the price is high for your budget and the specs go beyond what you need.';
  }
  return `High regret risk — the price is about ${ratio.toFixed(1)}× your monthly tech budget. Consider waiting for a drop or a cheaper alternative.`;
}

/**
 * Regret risk from price, budget and overkill points. Returns null
 * when the price is missing/non-positive or the budget is
 * missing/non-positive — no score from nothing.
 */
export function computeRegretRisk(input: RegretRiskInput): RegretRiskResult | null {
  const price = input.priceUsd;
  const budget = input.monthlyBudgetUsd;
  if (
    price === null ||
    price === undefined ||
    !Number.isFinite(price) ||
    price <= 0 ||
    budget === null ||
    budget === undefined ||
    !Number.isFinite(budget) ||
    budget <= 0
  ) {
    return null;
  }
  const overkill =
    Number.isFinite(input.specOverkillPoints) && input.specOverkillPoints > 0
      ? Math.min(25, Math.round(input.specOverkillPoints))
      : 0;
  const ratio = price / budget;
  const score = Math.min(100, Math.round(ratio * 40 + overkill + 15));
  const category = categoryForScore(score);
  const overkillUnassessed = input.overkillUnassessed === true;
  return {
    score,
    category,
    label: REGRET_CATEGORY_LABELS[category],
    advice: adviceFor({
      category,
      ratio,
      overkill,
      overkillUnassessed,
    }),
    priceToBudgetRatio: Math.round(ratio * 100) / 100,
    overkillUnassessed,
  };
}
