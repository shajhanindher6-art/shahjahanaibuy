/**
 * Local payments & checkout handoff per region (Section 5, item 11).
 *
 * Payment methods come ONLY from the store directory (lib/stores.ts
 * `paymentMethods`, each entry verified against the store's own
 * published payment information). A store with no verified entry
 * reports "not verified" — a payment method is never invented, and
 * SmartBuy never claims a store accepts a method it has not verified.
 *
 * SmartBuy is not a checkout: it never takes payment. The handoff
 * hint tells the shopper what to expect at the retailer's checkout,
 * and the full landed cost reuses the existing landed-cost calculator
 * (services/tax-estimator.ts estimateLandingPrice) — the formula is
 * NOT duplicated here. Duty is the documented 10% placeholder and
 * tax uses the standard-rate table; both are estimates, never a
 * customs quote, and the retailer sets the final price.
 */

import {
  getLocalOnlyStores,
  getStoresForCountry,
  type LocalStore,
  type StorePaymentMethod,
} from '@/lib/stores';
import {
  estimateLandingPrice,
  standardRateForCountry,
  manualRateNote,
  DEFAULT_DUTY_PCT,
  type TaxEstimate,
} from '@/services/tax-estimator';

export interface StorePaymentInfo {
  store: LocalStore;
  /** Verified methods only; [] when nothing is verified. */
  methods: StorePaymentMethod[];
  /** True when at least one method is verified for this store. */
  verified: boolean;
}

/**
 * Verified payment methods for one store. [] + verified:false when
 * the directory carries nothing for the store — the UI must say
 * "Payment methods not verified for this store".
 */
export function getPaymentMethodsForStore(store: LocalStore): StorePaymentInfo {
  const methods = (store.paymentMethods ?? []).filter((m) => m.verified);
  return { store, methods, verified: methods.length > 0 };
}

// ---------------------------------------------------------------------------
// Buy-Now-Pay-Later (Section 6, item 9)
// ---------------------------------------------------------------------------

/**
 * Stable id for a verified BNPL payment-method entry. A `bnpl`
 * entry may appear in a store's `paymentMethods` (lib/stores.ts
 * StorePaymentMethod) ONLY when verified against that store's own
 * published payments page — exactly like every other method. No
 * store carries a verified `bnpl` entry today (checked 2026-11-10:
 * Daraz PK and Flipkart IN, the only stores with verified payment
 * methods, publish no BNPL option). An unverified BNPL claim is
 * simply absent — never guessed, never shown as available.
 */
export const BNPL_METHOD_ID = 'bnpl';

/**
 * The verified BNPL entry for a store, or null when the store has
 * none verified. An entry with verified:false does not count.
 */
export function getBnplMethodForStore(store: LocalStore): StorePaymentMethod | null {
  const info = getPaymentMethodsForStore(store);
  return info.methods.find((m) => m.id === BNPL_METHOD_ID && m.verified) ?? null;
}

export interface MonthlyInstalment {
  /** Monthly amount in USD, rounded to 2 decimals. */
  monthlyUsd: number;
  /** False when no APR was supplied — monthlyUsd is then pre-interest. */
  aprKnown: boolean;
  /** Label the UI must show next to the monthly figure. */
  note: string;
}

export const BNPL_UNKNOWN_APR_NOTE =
  'before interest/fees — retailer confirms APR at checkout';

/**
 * Monthly instalment for a recorded total over a recorded term.
 *
 * - months missing, zero, negative or non-finite → null (no term,
 *   no instalment — never a guessed term).
 * - totalUsd missing, zero, negative or non-finite → null.
 * - aprPct null/undefined → total ÷ months, labelled with
 *   BNPL_UNKNOWN_APR_NOTE (pre-interest split, never a guessed APR).
 * - aprPct negative or non-finite → null (an APR below zero is not
 *   a recorded rate).
 * - aprPct 0 → total ÷ months, labelled as 0% APR.
 * - aprPct > 0 → standard amortisation: P·r / (1 − (1+r)^−n)
 *   with r = APR/100/12. No fee is ever added — no fee is recorded.
 */
export function monthlyInstalment(
  totalUsd: number | null | undefined,
  months: number | null | undefined,
  aprPct: number | null | undefined
): MonthlyInstalment | null {
  if (totalUsd === null || totalUsd === undefined || !Number.isFinite(totalUsd) || totalUsd <= 0) {
    return null;
  }
  if (months === null || months === undefined || !Number.isFinite(months) || months <= 0) {
    return null;
  }
  const n = Math.floor(months);
  if (n <= 0) return null;

  if (aprPct === null || aprPct === undefined) {
    return {
      monthlyUsd: Math.round((totalUsd / n) * 100) / 100,
      aprKnown: false,
      note: BNPL_UNKNOWN_APR_NOTE,
    };
  }
  if (!Number.isFinite(aprPct) || aprPct < 0) return null;
  if (aprPct === 0) {
    return {
      monthlyUsd: Math.round((totalUsd / n) * 100) / 100,
      aprKnown: true,
      note: 'At 0% APR as recorded — retailer confirms the final terms at checkout.',
    };
  }
  const r = aprPct / 100 / 12;
  const monthly = (totalUsd * r) / (1 - Math.pow(1 + r, -n));
  if (!Number.isFinite(monthly) || monthly <= 0) return null;
  return {
    monthlyUsd: Math.round(monthly * 100) / 100,
    aprKnown: true,
    note: `At ${aprPct}% APR as recorded — retailer confirms the final APR and fees at checkout.`,
  };
}

/**
 * Payment info for every local store in a country. Countries with no
 * confirmed local store (QA, ZA) fall back to the global stores,
 * which are all unverified — the result is honest about that.
 */
export function getPaymentMethodsForCountry(
  countryCode: string | null | undefined
): StorePaymentInfo[] {
  const local = getLocalOnlyStores(countryCode);
  const stores = local.length > 0 ? local : getStoresForCountry(countryCode).stores;
  return stores.map(getPaymentMethodsForStore);
}

/** Human note for a store's payment verification state. */
export function paymentVerificationNote(info: StorePaymentInfo): string {
  if (!info.verified) {
    return `Payment methods for ${info.store.name} have not been verified — check the payment options at checkout on ${info.store.name}.`;
  }
  return `Payment methods verified against ${info.store.name}'s published payment information (checked 2026-11-10). Availability can vary by listing and order — confirm at checkout.`;
}

/**
 * Checkout handoff hint for a store: what the shopper can expect to
 * pay with, plus the standing reminder that SmartBuy never processes
 * payment and the retailer sets the final price.
 */
export function checkoutHandoffHint(store: LocalStore, productName?: string): string {
  const info = getPaymentMethodsForStore(store);
  const product = productName ? ` for ${productName}` : '';
  if (!info.verified) {
    return (
      `You will check out on ${store.name}${product}. ` +
      `Payment methods for ${store.name} have not been verified — the store shows its accepted ` +
      `payment options at checkout. SmartBuy does not take payment; the retailer sets the final price.`
    );
  }
  const labels = info.methods.map((m) => m.label).join(', ');
  return (
    `You will check out on ${store.name}${product}. ` +
    `Verified payment options include: ${labels}. ` +
    `Availability can vary by listing and order — confirm at checkout. ` +
    `SmartBuy does not take payment; the retailer sets the final price.`
  );
}

// ---------------------------------------------------------------------------
// Full landed cost for the handoff (reuses the tax estimator)
// ---------------------------------------------------------------------------

export interface LandedCostForCheckout {
  estimate: TaxEstimate;
  /** Duty % actually used (the documented placeholder when unrecorded). */
  dutyPct: number;
  /** VAT/sales-tax % used, or null when the shopper must enter one. */
  vatPct: number | null;
  /** Notes the UI must show next to the total. */
  notes: string[];
}

/**
 * Full landed cost for one product at one destination, reusing
 * estimateLandingPrice (price + duty + shipping + VAT). The duty %
 * is the documented placeholder (10%) unless the caller passes a
 * recorded rate; the VAT % is the standard rate for the country, or
 * null (shopper-entered) for countries with no single rate. Shipping
 * is the shopper's own figure — 0 when unknown, never guessed.
 */
export function estimateLandedCostForCheckout(input: {
  priceUsd: number;
  countryCode: string;
  shippingUsd?: number;
  dutyPct?: number;
  vatPct?: number;
}): LandedCostForCheckout {
  const dutyPct = input.dutyPct ?? DEFAULT_DUTY_PCT;
  const standard = standardRateForCountry(input.countryCode);
  const vatPct = input.vatPct ?? standard?.ratePct ?? null;
  const shippingUsd = input.shippingUsd ?? 0;

  const estimate = estimateLandingPrice({
    priceUsd: input.priceUsd,
    dutyPct,
    vatPct: vatPct ?? 0,
    shippingUsd,
  });

  const notes: string[] = [
    'Estimate only — not a customs quote. The retailer sets the final price at checkout.',
  ];
  if (input.dutyPct === undefined) {
    notes.push(
      `Import duty uses the ${DEFAULT_DUTY_PCT}% placeholder — actual duty depends on the product's customs category. Confirm with the carrier or customs.`
    );
  }
  if (vatPct === null) {
    const manual = manualRateNote(input.countryCode);
    notes.push(
      manual ??
        'No single tax rate is recorded for this country — enter your local rate to complete the estimate.'
    );
  }
  if (shippingUsd === 0) {
    notes.push('Shipping is not included — enter the retailer\'s shipping cost for a complete total.');
  }
  return { estimate, dutyPct, vatPct, notes };
}
