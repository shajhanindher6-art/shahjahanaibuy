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
