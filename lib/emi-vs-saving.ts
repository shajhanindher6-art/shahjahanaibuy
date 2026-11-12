/**
 * EMI vs Save-Then-Buy Comparator — pure helpers for
 * /tools/emi-vs-saving (Section 16, E7 / item 25).
 *
 * One product price, both paths side by side:
 * - EMI: the standard reducing-balance math from lib/emi-calculator
 *   (user-entered rate only — no rate is preset here either).
 * - Save-then-buy: the saving-plan math from lib/future-you.ts
 *   (monthly saving = remaining ÷ months). Here the horizon is
 *   derived, not dated: months to save = ceil(price ÷ monthly
 *   saving), so the buyer owns the product outright after that
 *   many months, having paid exactly the price — no interest.
 *
 * Fair-comparison default: when the visitor does not enter a
 * monthly saving amount, the saving path uses the EMI monthly
 * installment itself as the monthly saving — the same monthly
 * outflow, two different outcomes. The verdict is arithmetic
 * only: saving always costs less (the interest), EMI always
 * delivers sooner (the product now). Neither path is a loan
 * offer, and the EMI side excludes fees, taxes, and charges.
 */

import { calculateEmi, type EmiResult } from '@/lib/emi-calculator';

export interface EmiVsSavingComparison {
  price: number;
  annualRatePercent: number;
  tenureMonths: number;
  emi: EmiResult;
  /** Monthly amount saved on the saving path. */
  monthlySavingUsd: number;
  /** Whole months of saving before the buyer can pay outright. */
  monthsToSave: number;
  /** Total paid on the saving path — exactly the price. */
  savingTotalUsd: number;
  /** EMI total minus price: what the interest costs. */
  interestSavedUsd: number;
  /** How many months sooner the EMI path delivers the product. */
  monthsSoonerWithEmi: number;
  verdict: string;
}

export function compareEmiVsSaving(input: {
  price: number;
  annualRatePercent: number;
  tenureMonths: number;
  /** Optional monthly saving; defaults to the EMI installment. */
  monthlySavingUsd?: number | null;
}): EmiVsSavingComparison | null {
  const emi = calculateEmi(input.price, input.annualRatePercent, input.tenureMonths);
  if (emi === null) return null;

  // An explicitly entered monthly saving must be positive;
  // only an omitted one defaults to the EMI installment.
  if (
    input.monthlySavingUsd !== undefined &&
    input.monthlySavingUsd !== null &&
    (!Number.isFinite(input.monthlySavingUsd) || input.monthlySavingUsd <= 0)
  ) {
    return null;
  }
  const monthlySavingUsd =
    input.monthlySavingUsd !== undefined && input.monthlySavingUsd !== null
      ? Math.round(input.monthlySavingUsd * 100) / 100
      : emi.monthlyEmi;

  const monthsToSave = Math.max(1, Math.ceil(input.price / monthlySavingUsd));
  const interestSavedUsd = Math.round((emi.totalPayable - input.price) * 100) / 100;
  const monthsSoonerWithEmi = Math.max(0, monthsToSave);

  return {
    price: Math.round(input.price * 100) / 100,
    annualRatePercent: input.annualRatePercent,
    tenureMonths: input.tenureMonths,
    emi,
    monthlySavingUsd,
    monthsToSave,
    savingTotalUsd: Math.round(input.price * 100) / 100,
    interestSavedUsd,
    monthsSoonerWithEmi,
    verdict:
      interestSavedUsd === 0
        ? `At 0% interest both paths cost the same $${emi.totalPayable.toFixed(2)} — EMI just delivers the product ${monthsToSave} month${monthsToSave === 1 ? '' : 's'} sooner.`
        : `Saving $${monthlySavingUsd.toFixed(2)} a month costs $${interestSavedUsd.toFixed(2)} less in total, but you wait ${monthsToSave} month${monthsToSave === 1 ? '' : 's'} to own it; EMI gives you the product now and costs $${emi.totalPayable.toFixed(2)} in total.`,
  };
}

/** Parse the page's GET params: ?price=…&rate=…&months=…&saving=…. */
export function parseEmiVsSavingParams(searchParams: {
  price?: string | string[];
  rate?: string | string[];
  months?: string | string[];
  saving?: string | string[];
}): {
  price: number | null;
  rate: number | null;
  months: number | null;
  saving: number | null;
  errors: string[];
  hasQuery: boolean;
} {
  const first = (v: string | string[] | undefined): string | undefined =>
    Array.isArray(v) ? v[0] : v;
  const rawPrice = first(searchParams.price);
  const rawRate = first(searchParams.rate);
  const rawMonths = first(searchParams.months);
  const rawSaving = first(searchParams.saving);
  const hasQuery =
    rawPrice !== undefined ||
    rawRate !== undefined ||
    rawMonths !== undefined ||
    rawSaving !== undefined;
  const errors: string[] = [];

  const num = (raw: string | undefined, label: string): number | null => {
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
  const months = monthsRaw !== null && Number.isInteger(monthsRaw) ? monthsRaw : monthsRaw;
  const saving = num(rawSaving, 'monthly saving');

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
  if (hasQuery && saving !== null && saving <= 0)
    errors.push('Monthly saving must be above $0 when entered — leave it blank to save the EMI amount each month.');

  return { price, rate, months, saving, errors, hasQuery };
}
