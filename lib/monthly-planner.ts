/**
 * AI Monthly Shopping Planner — Section 7, item 4.
 *
 * Pure planning math, built ON the existing Buy vs Wait engine
 * (services/buy-wait-prediction.ts) and the Tech Budget widget's
 * budget logic (services/tech-budget.ts `budgetStatus` semantics:
 * remaining = budget − total, over budget when negative).
 *
 * HONESTY RULES:
 * - A decision is per product: buy_now / wait / next_month, with a
 *   reason tied to the Buy vs Wait verdict AND the price vs the
 *   recorded 30-day low. No verdict is ever invented: no recorded
 *   price → next_month; < 2 price points → wait (the Buy vs Wait
 *   engine itself reports "not enough data").
 * - The monthly budget is a hard filter: a buy_now candidate that
 *   does not fit the remaining budget moves to next_month, never
 *   into an over-budget buy_now. Cheapest buy_now candidates are
 *   fitted first so the plan buys as much as possible.
 * - Unpriced products contribute $0 to every total, never a guess.
 */

import {
  predictBuyVsWait,
  type BuyWaitPoint,
  type BuyWaitPrediction,
} from '@/services/buy-wait-prediction';

export type PlanDecision = 'buy_now' | 'wait' | 'next_month';

export interface PlannerItemInput {
  productSlug: string;
  productName: string;
  /** Latest recorded price, or null when no price is recorded. */
  currentPrice: number | null;
  /** Lowest recorded price in the last 30 days, or null. */
  lowest30dPrice: number | null;
  /** Buy vs Wait verdict from the recorded price history, or null. */
  prediction: BuyWaitPrediction | null;
}

export interface PlannedItem {
  productSlug: string;
  productName: string;
  currentPrice: number | null;
  lowest30dPrice: number | null;
  decision: PlanDecision;
  reason: string;
  buyWaitConfidence: number | null;
}

export interface MonthlyPlan {
  items: PlannedItem[];
  buyNowTotalUsd: number;
  waitTotalUsd: number;
  nextMonthTotalUsd: number;
  remainingBudgetUsd: number;
  overBudget: boolean;
}

function money(value: number): string {
  return `$${value.toFixed(2)}`;
}

/** "At its 30-day low" note, or how far above the low the price sits. */
export function priceVsLowNote(currentPrice: number | null, lowest30dPrice: number | null): string {
  if (currentPrice === null || lowest30dPrice === null || lowest30dPrice <= 0) return '';
  if (currentPrice <= lowest30dPrice * 1.02) {
    return ` It is at its recorded 30-day low (${money(lowest30dPrice)}).`;
  }
  const pct = ((currentPrice - lowest30dPrice) / lowest30dPrice) * 100;
  return ` It sits ${pct.toFixed(0)}% above its recorded 30-day low (${money(lowest30dPrice)}).`;
}

/**
 * One product's decision, before the budget is applied.
 * Buy vs Wait says buy_now → buy_now; anything else (wait, or not
 * enough data) → wait; no recorded price at all → next_month.
 */
export function decidePlanItem(input: PlannerItemInput): PlannedItem {
  const { productSlug, productName, currentPrice, lowest30dPrice, prediction } = input;
  const lowNote = priceVsLowNote(currentPrice, lowest30dPrice);

  if (currentPrice === null) {
    return {
      productSlug,
      productName,
      currentPrice,
      lowest30dPrice,
      decision: 'next_month',
      reason:
        'No recorded price yet — this purchase cannot be planned this month. Check again once a price is recorded.',
      buyWaitConfidence: null,
    };
  }

  if (!prediction || prediction.recommendation === 'not_enough_data') {
    return {
      productSlug,
      productName,
      currentPrice,
      lowest30dPrice,
      decision: 'wait',
      reason: `Not enough recorded price history to judge — wait for more recorded prices before buying.${lowNote}`,
      buyWaitConfidence: prediction ? prediction.confidence : null,
    };
  }

  if (prediction.recommendation === 'buy_now') {
    return {
      productSlug,
      productName,
      currentPrice,
      lowest30dPrice,
      decision: 'buy_now',
      reason: `${prediction.reason}${lowNote}`,
      buyWaitConfidence: prediction.confidence,
    };
  }

  return {
    productSlug,
    productName,
    currentPrice,
    lowest30dPrice,
    decision: 'wait',
    reason: `${prediction.reason}${lowNote}`,
    buyWaitConfidence: prediction.confidence,
  };
}

/**
 * Apply the monthly budget (hard filter) to decided items.
 * buy_now candidates are fitted cheapest-first; one that does not
 * fit the remaining budget moves to next_month with an honest
 * reason. Totals use recorded prices only; unpriced items are $0.
 */
export function buildMonthlyPlan(
  inputs: PlannerItemInput[],
  budgetUsd: number
): MonthlyPlan {
  const decided = inputs.map(decidePlanItem);
  let remaining = Number.isFinite(budgetUsd) && budgetUsd > 0 ? budgetUsd : 0;

  // Cheapest buy_now candidates first, so the budget buys the most.
  const buyNowCandidates = decided
    .filter((item) => item.decision === 'buy_now')
    .sort((a, b) => (a.currentPrice ?? Number.POSITIVE_INFINITY) - (b.currentPrice ?? Number.POSITIVE_INFINITY));

  for (const item of buyNowCandidates) {
    const price = item.currentPrice ?? 0;
    if (price <= remaining) {
      remaining = Math.round((remaining - price) * 100) / 100;
    } else {
      item.decision = 'next_month';
      item.reason =
        `${item.productName} costs ${money(price)}, which does not fit the remaining ${money(remaining)} ` +
        `of this month's budget — move it to next month.`;
    }
  }

  const totalFor = (decision: PlanDecision): number =>
    Math.round(
      decided
        .filter((item) => item.decision === decision)
        .reduce((sum, item) => sum + (item.currentPrice ?? 0), 0) * 100
    ) / 100;

  const buyNowTotalUsd = totalFor('buy_now');
  return {
    items: decided,
    buyNowTotalUsd,
    waitTotalUsd: totalFor('wait'),
    nextMonthTotalUsd: totalFor('next_month'),
    remainingBudgetUsd: Math.round(remaining * 100) / 100,
    overBudget: false,
  };
}

/** Build a Buy vs Wait prediction from raw price-history points. */
export function predictFromPoints(points: BuyWaitPoint[]): BuyWaitPrediction {
  return predictBuyVsWait(points);
}

/** True only for a strict YYYY-MM month string (01–12). */
export function isValidMonth(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) return false;
  const month = Number(match[2]);
  return month >= 1 && month <= 12;
}

/** Current month as YYYY-MM (local time). */
export function currentMonth(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}
