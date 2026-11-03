/**
 * Cross-Border Customs & Duty Optimizer — a cost-COMPARISON framework
 * built on the Option 7 tax estimator. It extends that estimator; it
 * does not replace it and it does not invent a second rate table.
 *
 * HONESTY RULES (do not weaken them):
 * - Every figure is an ESTIMATE, never a customs quote. The UI must
 *   head the block "Estimate only — not a customs quote".
 * - De minimis thresholds are included ONLY where confidently known.
 *   Today that is exactly one country: the United States ($800,
 *   Section 321). Every other country reports "threshold unknown —
 *   no threshold benefit assumed" and the optimizer applies NO
 *   threshold benefit there. A threshold is never invented.
 * - The "optimal" scenario is only the cheapest ESTIMATE among the
 *   scenarios the USER entered. It is never a guaranteed saving.
 * - The UI must state: splitting can INCREASE total shipping cost
 *   and delivery time, customs may aggregate related shipments sent
 *   together, and this is a cost comparison, NOT advice to evade
 *   duties — the user must comply with local customs rules.
 * - Duty and VAT rates come from the tax estimator's tables/inputs
 *   (standard rates, user-editable, manual-rate fallback countries).
 */

import {
  DEFAULT_DUTY_PCT,
  estimateLandingPrice,
  type TaxEstimate,
} from './tax-estimator';

/**
 * De minimis thresholds (USD) where confidently known. Deliberately
 * minimal: only the US $800 Section 321 threshold is asserted here.
 * Any country not listed = threshold unknown = no benefit assumed.
 */
export const DE_MINIMIS_THRESHOLDS_USD: Record<string, number> = {
  US: 800,
};

export function deMinimisForCountry(countryCode: string): number | null {
  return DE_MINIMIS_THRESHOLDS_USD[countryCode.toUpperCase()] ?? null;
}

export interface OptimizerInput {
  /** Total order value in USD (default: the real cheapest price). */
  orderValueUsd: number;
  /** ISO country code of the destination. */
  countryCode: string;
  /** Duty % (user-adjustable; same placeholder default as estimator). */
  dutyPct: number;
  /** VAT/sales-tax % (user-editable standard rate or manual rate). */
  vatPct: number;
  /** Shipping cost per shipment in USD (user-entered). */
  shippingPerShipmentUsd: number;
  /** Number of shipments to compare, e.g. [1, 2, 3]. */
  shipmentCounts: number[];
}

export interface ScenarioBreakdown {
  shipments: number;
  /** Value per shipment (order value split evenly — a simplification, stated in UI). */
  valuePerShipmentUsd: number;
  dutyUsd: number;
  vatUsd: number;
  shippingUsd: number;
  totalUsd: number;
  /** True when the de minimis threshold waived duty+VAT for a shipment. */
  thresholdApplied: boolean;
}

export interface OptimizerResult {
  scenarios: ScenarioBreakdown[];
  /** Index of the cheapest scenario by estimated total (null if none). */
  cheapestIndex: number | null;
  /** Threshold used, or null when unknown for this country. */
  thresholdUsd: number | null;
  dutyPct: number;
  vatPct: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function perShipment(
  valueUsd: number,
  dutyPct: number,
  vatPct: number,
  shippingUsd: number,
  thresholdUsd: number | null
): { duty: number; vat: number; total: number; thresholdApplied: boolean } {
  // US Section 321 style: a shipment under the threshold is duty- and
  // tax-free. This applies ONLY when a threshold is known for the
  // country; otherwise the standard estimate runs unchanged.
  if (thresholdUsd !== null && valueUsd < thresholdUsd) {
    return { duty: 0, vat: 0, total: round2(valueUsd + shippingUsd), thresholdApplied: true };
  }
  const est: TaxEstimate = estimateLandingPrice({
    priceUsd: valueUsd,
    dutyPct,
    vatPct,
    shippingUsd,
  });
  return { duty: est.dutyUsd, vat: est.vatUsd, total: est.totalUsd, thresholdApplied: false };
}

/**
 * Compare the user's own split scenarios. Pure arithmetic on the
 * user's inputs — no rate, threshold, or saving is ever invented.
 */
export function optimizeShipments(input: OptimizerInput): OptimizerResult {
  const threshold = deMinimisForCountry(input.countryCode);
  const order = Math.max(0, input.orderValueUsd || 0);
  const shipping = Math.max(0, input.shippingPerShipmentUsd || 0);
  const counts = [...new Set(input.shipmentCounts.filter((n) => Number.isFinite(n) && n >= 1))].sort(
    (a, b) => a - b
  );
  const scenarios: ScenarioBreakdown[] = counts.map((n) => {
    const perValue = order / n;
    const one = perShipment(perValue, input.dutyPct, input.vatPct, shipping, threshold);
    return {
      shipments: n,
      valuePerShipmentUsd: round2(perValue),
      dutyUsd: round2(one.duty * n),
      vatUsd: round2(one.vat * n),
      shippingUsd: round2(shipping * n),
      totalUsd: round2(one.total * n),
      thresholdApplied: one.thresholdApplied,
    };
  });
  let cheapestIndex: number | null = null;
  for (let i = 0; i < scenarios.length; i++) {
    if (cheapestIndex === null || scenarios[i].totalUsd < scenarios[cheapestIndex].totalUsd) {
      cheapestIndex = i;
    }
  }
  return {
    scenarios,
    cheapestIndex,
    thresholdUsd: threshold,
    dutyPct: input.dutyPct,
    vatPct: input.vatPct,
  };
}

export { DEFAULT_DUTY_PCT };
