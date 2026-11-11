/**
 * Landed Cost / Import Duty Calculator — pure helpers for
 * /tools/landed-cost (Section 14, Chunk 2).
 *
 * Landed cost = product price + shipping + duty + VAT, where duty
 * applies to (price + shipping) and VAT applies to
 * (price + shipping + duty). Every rate is USER-ENTERED — the
 * calculator holds no duty table, no VAT table, and no shipping
 * table, and presets nothing.
 *
 * Honesty rules:
 * - The result is an ESTIMATE, labelled as one on the page: the
 *   duty and VAT percentages come from the user, not from any
 *   official tariff schedule, and the calculator never presents a
 *   figure as an official duty rate.
 * - All amounts are in USD as entered; no currency conversion is
 *   applied. If the price was quoted in another currency, convert
 *   it first (see /tools/currency-converter).
 */

export interface LandedCostInput {
  /** Product price in USD, as entered. */
  price: number;
  /** Shipping cost in USD, as entered (0 when free/unknown). */
  shipping: number;
  /** Duty rate in percent, as entered by the user. */
  dutyPercent: number;
  /** VAT / sales-tax rate in percent, as entered by the user. */
  vatPercent: number;
  /** Destination country, as typed by the user. */
  country: string;
}

export interface LandedCostResult extends LandedCostInput {
  /** price + shipping — the base duty is charged on this. */
  dutiableBase: number;
  duty: number;
  /** price + shipping + duty — the base VAT is charged on this. */
  taxableBase: number;
  vat: number;
  total: number;
  /** Total as a % uplift over the product price alone. */
  upliftPercent: number;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Calculate the landed-cost estimate. Returns null for an invalid
 * input: non-positive price, negative shipping, a percentage
 * outside 0–100, or an empty country.
 */
export function calculateLandedCost(
  input: LandedCostInput
): LandedCostResult | null {
  const { price, shipping, dutyPercent, vatPercent, country } = input;
  if (!Number.isFinite(price) || price <= 0) return null;
  if (!Number.isFinite(shipping) || shipping < 0) return null;
  if (
    !Number.isFinite(dutyPercent) ||
    dutyPercent < 0 ||
    dutyPercent > 100
  )
    return null;
  if (
    !Number.isFinite(vatPercent) ||
    vatPercent < 0 ||
    vatPercent > 100
  )
    return null;
  if (!country || country.trim().length === 0) return null;

  const dutiableBase = round2(price + shipping);
  const duty = round2((dutiableBase * dutyPercent) / 100);
  const taxableBase = round2(dutiableBase + duty);
  const vat = round2((taxableBase * vatPercent) / 100);
  const total = round2(taxableBase + vat);
  return {
    price: round2(price),
    shipping: round2(shipping),
    dutyPercent,
    vatPercent,
    country: country.trim(),
    dutiableBase,
    duty,
    taxableBase,
    vat,
    total,
    upliftPercent:
      price > 0 ? Math.round(((total - price) / price) * 1000) / 10 : 0,
  };
}

/** Parse the page's GET params: ?price=…&country=…&shipping=…&duty=…&vat=…. */
export function parseLandedCostParams(searchParams: {
  price?: string | string[];
  country?: string | string[];
  shipping?: string | string[];
  duty?: string | string[];
  vat?: string | string[];
}): {
  input: LandedCostInput | null;
  errors: string[];
  hasQuery: boolean;
} {
  const first = (v: string | string[] | undefined): string | undefined =>
    Array.isArray(v) ? v[0] : v;
  const rawPrice = first(searchParams.price);
  const rawCountry = first(searchParams.country);
  const rawShipping = first(searchParams.shipping);
  const rawDuty = first(searchParams.duty);
  const rawVat = first(searchParams.vat);

  const hasQuery =
    rawPrice !== undefined ||
    rawCountry !== undefined ||
    rawShipping !== undefined ||
    rawDuty !== undefined ||
    rawVat !== undefined;

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
  const shipping = num(rawShipping, 'shipping cost') ?? 0;
  const dutyPercent = num(rawDuty, 'duty rate') ?? 0;
  const vatPercent = num(rawVat, 'VAT rate') ?? 0;
  const country = rawCountry?.trim() ?? '';

  if (hasQuery && price === null && !errors.some((e) => e.toLowerCase().includes('price'))) {
    errors.push('Enter a product price above $0.');
  } else if (hasQuery && price !== null && price <= 0) {
    errors.push('Enter a product price above $0.');
  }
  if (shipping < 0) errors.push('Shipping cannot be negative.');
  if (dutyPercent < 0 || dutyPercent > 100)
    errors.push('Duty rate must be between 0% and 100%.');
  if (vatPercent < 0 || vatPercent > 100)
    errors.push('VAT rate must be between 0% and 100%.');
  if (hasQuery && country.length === 0)
    errors.push('Enter a destination country.');

  if (!hasQuery || errors.length > 0 || price === null || price <= 0) {
    return { input: null, errors, hasQuery };
  }
  return {
    input: { price, shipping, dutyPercent, vatPercent, country },
    errors,
    hasQuery,
  };
}
