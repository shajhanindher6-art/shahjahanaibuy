/**
 * Smart Local Tax & Import Duty Estimator — pure arithmetic, no keys.
 *
 * HONESTY RULES (do not weaken them):
 * - Every output line is an ESTIMATE. The UI must head the block
 *   "Estimate only — not a customs quote" and must never add the
 *   estimate into a merchant price as if it were the checkout total.
 * - VAT/sales-tax rates below are STANDARD rates only, verified
 *   against published 2026 standard-rate tables (EU/UK/others) at
 *   implementation time. Reduced rates, exemptions, and category
 *   rules are NOT modelled — the rate is always user-editable.
 * - The US has no single rate (varies by state) and Canada's
 *   GST/HST varies by province, so both fall back to "enter your
 *   local rate". Every other unlisted country does the same — a
 *   guessed rate is never presented as official.
 * - Import duty has NO per-country/per-category schedule here: it is
 *   a user-adjustable % with a documented placeholder default (10%,
 *   deliberately conservative — it errs toward a higher landing
 *   price). Actual duty depends on HS code, product category, and
 *   customs, and must be confirmed with the carrier/customs.
 *
 * Formula (stated, so the UI can show it):
 *   duty = price * dutyPct
 *   vatBase = price + duty + shipping
 *   vat = vatBase * vatPct
 *   total = price + duty + shipping + vat
 */

/** Standard VAT/GST rate by ISO country code (fraction, e.g. 0.19 = 19%). */
export const STANDARD_TAX_RATES: Record<string, { rate: number; label: string }> = {
  DE: { rate: 0.19, label: 'VAT (MwSt)' },
  FR: { rate: 0.2, label: 'VAT (TVA)' },
  GB: { rate: 0.2, label: 'VAT' },
  IT: { rate: 0.22, label: 'VAT (IVA)' },
  ES: { rate: 0.21, label: 'VAT (IVA)' },
  NL: { rate: 0.21, label: 'VAT (BTW)' },
  BE: { rate: 0.21, label: 'VAT' },
  AT: { rate: 0.2, label: 'VAT' },
  IE: { rate: 0.23, label: 'VAT' },
  PT: { rate: 0.23, label: 'VAT (IVA)' },
  PL: { rate: 0.23, label: 'VAT' },
  SE: { rate: 0.25, label: 'VAT' },
  DK: { rate: 0.25, label: 'VAT' },
  FI: { rate: 0.255, label: 'VAT' },
  GR: { rate: 0.24, label: 'VAT' },
  TR: { rate: 0.2, label: 'VAT (KDV)' },
  CH: { rate: 0.081, label: 'VAT' },
  JP: { rate: 0.1, label: 'Consumption tax' },
  KR: { rate: 0.1, label: 'VAT' },
  SG: { rate: 0.09, label: 'GST' },
  AU: { rate: 0.1, label: 'GST' },
  IN: { rate: 0.18, label: 'GST (standard)' },
  PK: { rate: 0.18, label: 'Sales tax (standard)' },
  MX: { rate: 0.16, label: 'VAT (IVA)' },
  AE: { rate: 0.05, label: 'VAT' },
  SA: { rate: 0.15, label: 'VAT' },
  ZA: { rate: 0.15, label: 'VAT' },
};

/** Countries with no single rate: the UI must ask for a manual rate. */
export const MANUAL_RATE_COUNTRIES: Record<string, string> = {
  US: 'The US has no single sales-tax rate — it varies by state. Enter your local rate.',
  CA: 'Canada’s GST/HST varies by province. Enter your local rate.',
};

/** Placeholder default duty % — adjustable, never a schedule. See header. */
export const DEFAULT_DUTY_PCT = 10;

export interface TaxEstimateInput {
  /** Merchant price in USD (a real recorded price, never invented). */
  priceUsd: number;
  /** Duty rate as a percent, e.g. 10 means 10%. */
  dutyPct: number;
  /** VAT/sales-tax rate as a percent. */
  vatPct: number;
  /** Shipping cost in USD (user-entered; 0 when unknown). */
  shippingUsd: number;
}

export interface TaxEstimate {
  priceUsd: number;
  dutyUsd: number;
  shippingUsd: number;
  vatBaseUsd: number;
  vatUsd: number;
  /** Estimated total landing price in USD. */
  totalUsd: number;
}

export function estimateLandingPrice(input: TaxEstimateInput): TaxEstimate {
  const price = Math.max(0, input.priceUsd || 0);
  const dutyPct = Math.max(0, input.dutyPct || 0) / 100;
  const vatPct = Math.max(0, input.vatPct || 0) / 100;
  const shipping = Math.max(0, input.shippingUsd || 0);
  const duty = price * dutyPct;
  const vatBase = price + duty + shipping;
  const vat = vatBase * vatPct;
  return {
    priceUsd: round2(price),
    dutyUsd: round2(duty),
    shippingUsd: round2(shipping),
    vatBaseUsd: round2(vatBase),
    vatUsd: round2(vat),
    totalUsd: round2(price + duty + shipping + vat),
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Standard rate for a country code, or null when the user must enter one. */
export function standardRateForCountry(
  countryCode: string
): { ratePct: number; label: string } | null {
  const entry = STANDARD_TAX_RATES[countryCode.toUpperCase()];
  if (!entry) return null;
  return { ratePct: entry.rate * 100, label: entry.label };
}

/** Human note for countries without a single rate, or null. */
export function manualRateNote(countryCode: string): string | null {
  return MANUAL_RATE_COUNTRIES[countryCode.toUpperCase()] ?? null;
}
