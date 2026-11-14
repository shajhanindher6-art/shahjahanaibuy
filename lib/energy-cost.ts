/**
 * AI Energy Cost Calculator — pure helpers for /tools/energy-cost.
 *
 * Math: watts × hours/day × 365 ÷ 1000 × tariff = annual cost
 * (kWh per year × price per kWh), plus the 5-year total.
 * Deterministic, zero LLM, no lookup of any kind.
 *
 * Honesty rules:
 * - There is NO tariff default: the tariff varies by country and
 *   provider, so the page leaves it empty and prompts the user to
 *   enter it. A missing tariff is never filled in with a "typical"
 *   value.
 * - The catalog has no wattage data (0 specs rows) — watts are
 *   ALWAYS user-entered, never looked up from a product. Picking a
 *   catalog product only labels the result; it changes no number.
 * - The result is labelled "based on the watts and tariff you
 *   entered" — never a measured consumption figure for any product.
 */

/** The basis label shown with every result on the page. */
export const ENERGY_COST_BASIS_LABEL =
  'based on the watts and tariff you entered';

export interface EnergyCostResult {
  watts: number;
  hoursPerDay: number;
  /** Tariff in USD per kWh, as entered. */
  tariffPerKwh: number;
  /** kWh per year, rounded to 2 decimals. */
  annualKwh: number;
  /** Cost per day in USD, rounded to 2 decimals. */
  dailyCost: number;
  /** Cost per month in USD (annual / 12), rounded to 2 decimals. */
  monthlyCost: number;
  /** Cost per year in USD, rounded to 2 decimals. */
  annualCost: number;
  /** Cost over 5 years in USD (annual × 5), rounded to 2 decimals. */
  fiveYearCost: number;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Calculate the running cost. Returns null for an invalid input:
 * watts must be positive (and at most 100,000), hours/day must be
 * above 0 and at most 24, and the tariff must be positive. A zero
 * or missing tariff is never defaulted — the caller reports it as
 * "enter your tariff" instead of computing a $0 result.
 */
export function calculateEnergyCost(
  watts: number,
  hoursPerDay: number,
  tariffPerKwh: number
): EnergyCostResult | null {
  if (!Number.isFinite(watts) || watts <= 0 || watts > 100_000) return null;
  if (!Number.isFinite(hoursPerDay) || hoursPerDay <= 0 || hoursPerDay > 24)
    return null;
  if (!Number.isFinite(tariffPerKwh) || tariffPerKwh <= 0) return null;
  const annualKwh = round2((watts * hoursPerDay * 365) / 1000);
  const annualCost = round2(annualKwh * tariffPerKwh);
  return {
    watts,
    hoursPerDay,
    tariffPerKwh,
    annualKwh,
    dailyCost: round2(annualCost / 365),
    monthlyCost: round2(annualCost / 12),
    annualCost,
    fiveYearCost: round2(annualCost * 5),
  };
}

/** Parse the page's GET params: ?watts=…&hours=…&tariff=…&product=…. */
export function parseEnergyCostParams(searchParams: {
  watts?: string | string[];
  hours?: string | string[];
  tariff?: string | string[];
  product?: string | string[];
}): {
  watts: number | null;
  hoursPerDay: number | null;
  /** Null when the tariff field was left empty — never defaulted. */
  tariffPerKwh: number | null;
  /** Catalog slug picked for the label only, or ''. */
  productSlug: string;
  wattsError: string | null;
  hoursError: string | null;
  tariffError: string | null;
} {
  const first = (v: string | string[] | undefined): string | undefined =>
    Array.isArray(v) ? v[0] : v;
  const rawWatts = first(searchParams.watts);
  const rawHours = first(searchParams.hours);
  const rawTariff = first(searchParams.tariff);
  const rawProduct = first(searchParams.product);

  let watts: number | null = null;
  let wattsError: string | null = null;
  if (rawWatts !== undefined && rawWatts.trim().length > 0) {
    const parsed = Number(rawWatts.replace(/,/g, ''));
    if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 100_000) {
      wattsError = `"${rawWatts}" is not a valid wattage — enter a positive number of watts.`;
    } else {
      watts = parsed;
    }
  }

  let hoursPerDay: number | null = null;
  let hoursError: string | null = null;
  if (rawHours !== undefined && rawHours.trim().length > 0) {
    const parsed = Number(rawHours.replace(/,/g, ''));
    if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 24) {
      hoursError = `"${rawHours}" is not valid — enter hours per day between 0 and 24.`;
    } else {
      hoursPerDay = parsed;
    }
  }

  let tariffPerKwh: number | null = null;
  let tariffError: string | null = null;
  if (rawTariff !== undefined && rawTariff.trim().length > 0) {
    const parsed = Number(rawTariff.replace(/,/g, ''));
    if (!Number.isFinite(parsed) || parsed <= 0) {
      tariffError = `"${rawTariff}" is not a valid tariff — enter a positive price per kWh.`;
    } else {
      tariffPerKwh = parsed;
    }
  } else if (rawTariff !== undefined) {
    // Submitted with an empty tariff: prompt, never default.
    tariffError = 'Enter your electricity tariff (price per kWh) — there is no default tariff.';
  }

  return {
    watts,
    hoursPerDay,
    tariffPerKwh,
    productSlug: (rawProduct ?? '').trim(),
    wattsError,
    hoursError,
    tariffError,
  };
}
