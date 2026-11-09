/**
 * True-Cost Per Hour Engine (Option 16, Step 2).
 *
 * Deterministic, no LLM, no fetch, no scraping. Pure math over the
 * total ownership cost (real recorded price + the shopper's own extras),
 * a fixed 3-year horizon, and the shopper's daily target hours.
 *
 *   Cost Per Hour = Total Ownership Cost / (3 Years * 365 Days * Daily Hours)
 *
 * The 3-year horizon is the spec's fixed horizon — it is NOT the
 * product's lifespan. Daily cost uses the product's own lifespan
 * instead (see computeDailyCost), and the monthly saving target is the
 * plain division price / months — the spec's
 * `price / (daily_target_hours * 30)` was a units error ($/hour, not
 * $/month) and is corrected here (see audit 2026-11-09).
 *
 * A null result means the cost cannot be calculated (no price, or no
 * usable daily hours) — the UI must say so, never show $0.00 as if
 * the product were free.
 */

export const COST_PER_HOUR_HORIZON_YEARS = 3;
export const COST_PER_HOUR_HORIZON_DAYS = COST_PER_HOUR_HORIZON_YEARS * 365;

export interface CostPerHourResult {
  /** USD per active hour, or null when it cannot be calculated. */
  costPerHourUsd: number | null;
  /** USD per day at the same horizon, or null when not calculable. */
  dailyCostUsd: number | null;
  /** 'ok' when both numbers exist, otherwise 'not-enough-data'. */
  status: 'ok' | 'not-enough-data';
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Cost per active hour from the total ownership cost and daily hours.
 * Total hours = 3 years × 365 days × daily hours.
 */
export function computeCostPerHour(input: {
  totalOwnershipUsd: number | null;
  dailyHours: number | null;
}): CostPerHourResult {
  const total = input.totalOwnershipUsd;
  const hours = input.dailyHours;
  if (
    total === null ||
    total === undefined ||
    !Number.isFinite(total) ||
    total <= 0 ||
    hours === null ||
    hours === undefined ||
    !Number.isFinite(hours) ||
    hours <= 0
  ) {
    return { costPerHourUsd: null, dailyCostUsd: null, status: 'not-enough-data' };
  }
  const totalHours = COST_PER_HOUR_HORIZON_DAYS * hours;
  const costPerHourUsd = round2(total / totalHours);
  const dailyCostUsd = round2(total / COST_PER_HOUR_HORIZON_DAYS);
  return { costPerHourUsd, dailyCostUsd, status: 'ok' };
}

/** "$0.46 / active hour" — returns '—' when the value is null. */
export function formatCostPerHour(costPerHourUsd: number | null): string {
  if (costPerHourUsd === null || !Number.isFinite(costPerHourUsd)) return '—';
  return `$${costPerHourUsd.toFixed(2)} / active hour`;
}

/**
 * Plain-language label for an hourly cost. Thresholds are fixed
 * reference points, not prices: under $0.25 is cheaper than a cup of
 * chai, under $0.50 cheaper than a daily coffee.
 */
export function labelForCostPerHour(costPerHourUsd: number | null): string {
  if (costPerHourUsd === null || !Number.isFinite(costPerHourUsd)) {
    return 'Hourly cost not available yet';
  }
  if (costPerHourUsd < 0.25) return 'Cheaper than a cup of chai';
  if (costPerHourUsd < 0.5) return 'Cheaper than daily coffee';
  if (costPerHourUsd < 1) return 'About the price of a coffee an hour';
  return 'Premium hourly cost — only worth it with heavy daily use';
}

/**
 * Daily cost over the product's own lifespan: price / (lifespan × 365).
 * Returns null when the price or lifespan is missing/non-positive.
 */
export function computeDailyCost(input: {
  priceUsd: number | null;
  lifespanYears: number | null;
}): number | null {
  const price = input.priceUsd;
  const years = input.lifespanYears;
  if (
    price === null ||
    price === undefined ||
    !Number.isFinite(price) ||
    price <= 0 ||
    years === null ||
    years === undefined ||
    !Number.isFinite(years) ||
    years <= 0
  ) {
    return null;
  }
  return round2(price / (years * 365));
}

/**
 * Monthly saving target: set aside price / months each month to afford
 * the product in `months` months. Returns null for a missing price or
 * a non-positive month count.
 */
export function monthlySavingTarget(input: {
  priceUsd: number | null;
  months: number;
}): number | null {
  const price = input.priceUsd;
  const months = input.months;
  if (
    price === null ||
    price === undefined ||
    !Number.isFinite(price) ||
    price <= 0 ||
    !Number.isFinite(months) ||
    months <= 0
  ) {
    return null;
  }
  return round2(price / months);
}
