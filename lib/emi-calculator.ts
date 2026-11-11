/**
 * EMI / Installment Calculator — pure helpers for
 * /tools/emi-calculator (Section 14, Chunk 2).
 *
 * Standard reducing-balance EMI:
 *   r = annualRate / 12 / 100, n = tenure months
 *   EMI = P * r * (1+r)^n / ((1+r)^n - 1), or P / n when r = 0.
 *
 * Honesty rules:
 * - The interest rate is USER-ENTERED ONLY. This module holds no
 *   default rate, no bank table, and no "typical" rate — the page
 *   requires the user to type the rate their lender quoted.
 * - The result is arithmetic only: monthly installment, total
 *   payable, and total interest for the entered price, rate, and
 *   tenure. It is not a loan offer and does not include fees,
 *   taxes, or processing charges, which vary by lender.
 */

export interface EmiResult {
  principal: number;
  annualRatePercent: number;
  tenureMonths: number;
  /** Monthly installment, rounded to 2 decimals. */
  monthlyEmi: number;
  /** monthlyEmi * tenureMonths, rounded to 2 decimals. */
  totalPayable: number;
  /** totalPayable - principal, rounded to 2 decimals. */
  totalInterest: number;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Calculate the EMI. Returns null for an invalid input: a
 * non-positive principal, a rate outside 0–100%, or a tenure
 * outside 1–360 months (non-integer tenures are rejected).
 */
export function calculateEmi(
  principal: number,
  annualRatePercent: number,
  tenureMonths: number
): EmiResult | null {
  if (!Number.isFinite(principal) || principal <= 0) return null;
  if (
    !Number.isFinite(annualRatePercent) ||
    annualRatePercent < 0 ||
    annualRatePercent > 100
  )
    return null;
  if (
    !Number.isFinite(tenureMonths) ||
    !Number.isInteger(tenureMonths) ||
    tenureMonths < 1 ||
    tenureMonths > 360
  )
    return null;

  const monthlyRate = annualRatePercent / 12 / 100;
  let monthlyEmi: number;
  if (monthlyRate === 0) {
    monthlyEmi = principal / tenureMonths;
  } else {
    const factor = Math.pow(1 + monthlyRate, tenureMonths);
    monthlyEmi = (principal * monthlyRate * factor) / (factor - 1);
  }
  monthlyEmi = round2(monthlyEmi);
  const totalPayable = round2(monthlyEmi * tenureMonths);
  return {
    principal: round2(principal),
    annualRatePercent,
    tenureMonths,
    monthlyEmi,
    totalPayable,
    totalInterest: round2(totalPayable - principal),
  };
}

/** Parse the page's GET params: ?price=…&rate=…&months=…. */
export function parseEmiParams(searchParams: {
  price?: string | string[];
  rate?: string | string[];
  months?: string | string[];
}): {
  price: number | null;
  rate: number | null;
  months: number | null;
  errors: string[];
  hasQuery: boolean;
} {
  const first = (v: string | string[] | undefined): string | undefined =>
    Array.isArray(v) ? v[0] : v;
  const rawPrice = first(searchParams.price);
  const rawRate = first(searchParams.rate);
  const rawMonths = first(searchParams.months);

  const hasQuery =
    rawPrice !== undefined ||
    rawRate !== undefined ||
    rawMonths !== undefined;

  const errors: string[] = [];
  const num = (
    raw: string | undefined,
    label: string
  ): number | null => {
    if (raw === undefined || raw.trim().length === 0) return null;
    const parsed = Number(raw.replace(/,/g, ''));
    if (!Number.isFinite(parsed)) {
      errors.push(`"${raw}" is not a valid ${label} — enter a number.`);
      return null;
    }
    return parsed;
  };

  const price = num(rawPrice, 'price');
  const rate = num(rawRate, 'interest rate');
  const monthsRaw = num(rawMonths, 'tenure');
  const months =
    monthsRaw !== null && Number.isInteger(monthsRaw) ? monthsRaw : monthsRaw;

  if (hasQuery && price === null && (rawPrice === undefined || rawPrice.trim().length === 0))
    errors.push('Enter the product price.');
  if (hasQuery && price !== null && price <= 0)
    errors.push('Enter a product price above $0.');
  if (hasQuery && rate === null && (rawRate === undefined || rawRate.trim().length === 0))
    errors.push('Enter the annual interest rate your lender quoted — no rate is preset.');
  if (hasQuery && rate !== null && (rate < 0 || rate > 100))
    errors.push('Interest rate must be between 0% and 100% per year.');
  if (hasQuery && months === null && (rawMonths === undefined || rawMonths.trim().length === 0))
    errors.push('Enter the tenure in months.');
  if (hasQuery && months !== null && (!Number.isInteger(months) || months < 1 || months > 360))
    errors.push('Tenure must be a whole number of months between 1 and 360.');

  return { price, rate, months, errors, hasQuery };
}
