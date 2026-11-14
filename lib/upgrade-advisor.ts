/**
 * AI Upgrade Advisor — pure helpers for /tools/upgrade-advisor.
 *
 * Deterministic verdict tiers — Keep / Wait / Upgrade — from
 * cost-per-year math (price paid ÷ years owned) vs the successor's
 * RECORDED price, plus a resale projection.
 *
 * The resale projection itself lives in services/resale-predictor.ts
 * (predictResaleValue: straight-line projection from the product's
 * OWN recorded price decline; needs ≥2 points spanning ≥7 days).
 * This module deliberately does NOT import services/ — the page
 * runs the predictor and passes the projected value in. lib/ must
 * not import services/.
 *
 * Honesty rules:
 * - NO trade-in value is recorded anywhere — this module never
 *   quotes one, and the page states that plainly.
 * - The resale figure is a PROJECTION, and its basis is labelled:
 *   the recorded prices are currently seed/demo prices from
 *   2026-11-02, not live market prices. Never a guaranteed resale
 *   value, never a trade-in quote.
 * - Successor prices are RECORDED prices shown with their STALE
 *   label — never a live price.
 * - Never claim the successor is "better" on specs (0 specs rows).
 * - If the current device is not in the catalog, all math uses the
 *   user's entered price.
 */

/** Verdict tiers. */
export type UpgradeVerdict = 'keep' | 'wait' | 'upgrade';

/** Label shown with every resale figure. */
export const RESALE_PROJECTION_LABEL =
  'PROJECTION — straight-line projection from the product’s own recorded price history (seed/demo prices from 2026-11-02, not live market prices). Not a resale quote or a guarantee. No trade-in value is recorded.';

/** Label shown with every successor price. */
export const SUCCESSOR_PRICE_STALE_LABEL =
  'STALE — recorded price, not a live price.';

/** A device owned less than this many years has not amortized yet. */
export const UPGRADE_KEEP_YEARS = 2;
/** An upgrade is worth doing once the device is at least this old… */
export const UPGRADE_MIN_YEARS = 3;
/** …and the net upgrade cost is at most this many years of the current device's cost per year. */
export const UPGRADE_BREAK_EVEN_YEARS = 2;
/** Below this break-even the advice is to wait for a better price. */
export const WAIT_BREAK_EVEN_YEARS = 4;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export interface UpgradeAdviceInput {
  /** Price the user paid for their current device, USD. */
  pricePaid: number;
  /** Year the current device was bought. */
  purchaseYear: number;
  /** Defaults to the current calendar year. */
  currentYear?: number;
  /** The successor's recorded price, or null when none is recorded. */
  successorPrice: number | null;
  /**
   * Projected resale value of the current device at 24 months
   * (predictResaleValue projectedValueUsd24), or null when no
   * projection could be made.
   */
  resaleProjectedValue: number | null;
}

export interface UpgradeAdvice {
  verdict: UpgradeVerdict;
  yearsOwned: number;
  /** Price paid ÷ years owned (divisor 1 when bought this year). */
  costPerYear: number;
  successorPrice: number | null;
  resaleProjectedValue: number | null;
  /** Successor price minus the projected resale (null without a successor price). */
  netUpgradeCost: number | null;
  /** Net upgrade cost ÷ cost per year (null without a successor price). */
  yearsToBreakEven: number | null;
  reason: string;
}

/**
 * Cost per year: price paid ÷ years owned. Years owned is the
 * calendar-year difference; a device bought this year counts as
 * 1 year (its full price is its first-year cost).
 */
export function calculateCostPerYear(
  pricePaid: number,
  purchaseYear: number,
  currentYear: number = new Date().getFullYear()
): number | null {
  if (!Number.isFinite(pricePaid) || pricePaid <= 0) return null;
  if (
    !Number.isInteger(purchaseYear) ||
    purchaseYear < 1990 ||
    purchaseYear > currentYear
  )
    return null;
  const yearsOwned = Math.max(1, currentYear - purchaseYear);
  return round2(pricePaid / yearsOwned);
}

/**
 * Deterministic verdict tiers:
 * - No recorded successor price → Wait (the upgrade cost cannot be
 *   computed from a price that does not exist).
 * - Net upgrade cost ≤ $0 (projected resale covers the successor's
 *   recorded price) → Upgrade.
 * - Owned less than 2 years → Keep (not amortized yet).
 * - Owned ≥ 3 years and the net cost is at most 2 years of the
 *   current device's cost per year → Upgrade.
 * - Net cost at most 4 years of cost per year → Wait (close — wait
 *   for a recorded price drop or more amortization).
 * - Otherwise → Keep.
 */
export function decideUpgrade(input: UpgradeAdviceInput): UpgradeAdvice | null {
  const currentYear = input.currentYear ?? new Date().getFullYear();
  const costPerYear = calculateCostPerYear(
    input.pricePaid,
    input.purchaseYear,
    currentYear
  );
  if (costPerYear === null) return null;
  const yearsOwned = Math.max(1, currentYear - input.purchaseYear);
  const successorPrice =
    input.successorPrice !== null &&
    Number.isFinite(input.successorPrice) &&
    input.successorPrice > 0
      ? input.successorPrice
      : null;
  const resale =
    input.resaleProjectedValue !== null &&
    Number.isFinite(input.resaleProjectedValue) &&
    input.resaleProjectedValue > 0
      ? round2(input.resaleProjectedValue)
      : null;

  if (successorPrice === null) {
    return {
      verdict: 'wait',
      yearsOwned,
      costPerYear,
      successorPrice: null,
      resaleProjectedValue: resale,
      netUpgradeCost: null,
      yearsToBreakEven: null,
      reason:
        'No recorded price for the successor yet, so the upgrade cost cannot be computed. Wait until a price is recorded before deciding.',
    };
  }

  const netUpgradeCost = round2(successorPrice - (resale ?? 0));
  const yearsToBreakEven = round2(netUpgradeCost / costPerYear);
  const base = {
    yearsOwned,
    costPerYear,
    successorPrice,
    resaleProjectedValue: resale,
    netUpgradeCost,
    yearsToBreakEven,
  };

  if (netUpgradeCost <= 0) {
    return {
      ...base,
      verdict: 'upgrade',
      reason: `The projected resale value ($${(resale ?? 0).toFixed(2)}) covers the successor’s recorded price ($${successorPrice.toFixed(2)}), so the net upgrade cost is $${netUpgradeCost.toFixed(2)}. That resale figure is a projection, not a guaranteed amount — but on the recorded numbers the upgrade pays for itself.`,
    };
  }

  if (yearsOwned < UPGRADE_KEEP_YEARS) {
    return {
      ...base,
      verdict: 'keep',
      reason: `You have owned this device less than ${UPGRADE_KEEP_YEARS} years, so its cost per year ($${costPerYear.toFixed(2)}) is still high — it has not amortized yet. The net upgrade cost is $${netUpgradeCost.toFixed(2)}, about ${yearsToBreakEven} years of what the current device costs per year. Keep it for now.`,
    };
  }

  if (yearsOwned >= UPGRADE_MIN_YEARS && yearsToBreakEven <= UPGRADE_BREAK_EVEN_YEARS) {
    return {
      ...base,
      verdict: 'upgrade',
      reason: `You have owned this device ${yearsOwned} years, so its cost per year is down to $${costPerYear.toFixed(2)}. The net upgrade cost is $${netUpgradeCost.toFixed(2)} — about ${yearsToBreakEven} years of that — so upgrading now is reasonable on the recorded numbers.`,
    };
  }

  if (yearsToBreakEven <= WAIT_BREAK_EVEN_YEARS) {
    return {
      ...base,
      verdict: 'wait',
      reason: `The net upgrade cost is $${netUpgradeCost.toFixed(2)}, about ${yearsToBreakEven} years of the current device’s $${costPerYear.toFixed(2)} per year. That is close, but not yet cheap enough — wait for a recorded price drop on the successor or another year of use from the current device.`,
    };
  }

  return {
    ...base,
    verdict: 'keep',
    reason: `The net upgrade cost is $${netUpgradeCost.toFixed(2)}, about ${yearsToBreakEven} years of the current device’s $${costPerYear.toFixed(2)} per year. That is too much to pay for an upgrade right now — keep the current device.`,
  };
}

export interface CatalogSuccessorCandidate {
  slug: string;
  name: string;
  brand: string | null;
  category: string | null;
}

/**
 * Same-category successors: catalog products whose recorded
 * category text matches the user's stated category
 * (case-insensitive). Never a spec comparison — 0 specs rows —
 * just a same-category shortlist to pick from.
 */
export function findSameCategorySuccessors(
  products: CatalogSuccessorCandidate[],
  category: string
): CatalogSuccessorCandidate[] {
  const wanted = category.trim().toLowerCase();
  if (!wanted) return [];
  return products.filter(
    (p) => (p.category ?? '').trim().toLowerCase() === wanted
  );
}

/** Parse the page's GET params: ?brand=…&category=…&year=…&price=…&current=…&successor=…. */
export function parseUpgradeAdvisorParams(searchParams: {
  brand?: string | string[];
  category?: string | string[];
  year?: string | string[];
  price?: string | string[];
  current?: string | string[];
  successor?: string | string[];
}): {
  brand: string;
  category: string;
  purchaseYear: number | null;
  pricePaid: number | null;
  currentSlug: string;
  successorSlug: string;
  yearError: string | null;
  priceError: string | null;
} {
  const first = (v: string | string[] | undefined): string | undefined =>
    Array.isArray(v) ? v[0] : v;
  const rawYear = first(searchParams.year);
  const rawPrice = first(searchParams.price);
  const currentYear = new Date().getFullYear();

  let purchaseYear: number | null = null;
  let yearError: string | null = null;
  if (rawYear !== undefined && rawYear.trim().length > 0) {
    const parsed = Number(rawYear.replace(/,/g, ''));
    if (
      !Number.isInteger(parsed) ||
      parsed < 1990 ||
      parsed > currentYear
    ) {
      yearError = `"${rawYear}" is not a valid purchase year — enter a year between 1990 and ${currentYear}.`;
    } else {
      purchaseYear = parsed;
    }
  }

  let pricePaid: number | null = null;
  let priceError: string | null = null;
  if (rawPrice !== undefined && rawPrice.trim().length > 0) {
    const parsed = Number(rawPrice.replace(/,/g, ''));
    if (!Number.isFinite(parsed) || parsed <= 0) {
      priceError = `"${rawPrice}" is not a valid price — enter the positive price you paid.`;
    } else {
      pricePaid = parsed;
    }
  }

  return {
    brand: (first(searchParams.brand) ?? '').trim(),
    category: (first(searchParams.category) ?? '').trim(),
    purchaseYear,
    pricePaid,
    currentSlug: (first(searchParams.current) ?? '').trim(),
    successorSlug: (first(searchParams.successor) ?? '').trim(),
    yearError,
    priceError,
  };
}
