import { describe, expect, it } from 'vitest';
import {
  getPaymentMethodsForCountry,
  getPaymentMethodsForStore,
  checkoutHandoffHint,
  paymentVerificationNote,
  estimateLandedCostForCheckout,
} from '@/lib/local-payments';
import { getLocalStores } from '@/lib/stores';
import { resolveCarbonLabel } from '@/lib/sustainability';

describe('local payments from the store directory', () => {
  it('reports verified methods for Daraz (PK) including COD', () => {
    const daraz = getLocalStores('PK').find((s) => s.slug === 'daraz');
    expect(daraz).toBeDefined();
    const info = getPaymentMethodsForStore(daraz!);
    expect(info.verified).toBe(true);
    expect(info.methods.map((m) => m.id)).toContain('cod');
    expect(info.methods.every((m) => m.verified)).toBe(true);
  });

  it('reports verified methods for Flipkart (IN) including COD and UPI', () => {
    const flipkart = getLocalStores('IN').find((s) => s.slug === 'flipkart');
    expect(flipkart).toBeDefined();
    const info = getPaymentMethodsForStore(flipkart!);
    expect(info.verified).toBe(true);
    expect(info.methods.map((m) => m.id)).toEqual(
      expect.arrayContaining(['cod', 'upi'])
    );
  });

  it('reports "not verified" for stores with no verified payment data', () => {
    const infos = getPaymentMethodsForCountry('US');
    expect(infos.length).toBeGreaterThan(0);
    // eBay US carries no verified payment entry in the directory.
    const ebay = infos.find((i) => i.store.slug === 'ebay');
    expect(ebay).toBeDefined();
    expect(ebay!.verified).toBe(false);
    expect(ebay!.methods).toEqual([]);
    expect(paymentVerificationNote(ebay!)).toContain('not been verified');
  });

  it('falls back to global stores (all unverified) for countries with no local store', () => {
    const infos = getPaymentMethodsForCountry('ZA');
    expect(infos.length).toBeGreaterThan(0);
    expect(infos.every((i) => i.verified === false)).toBe(true);
  });

  it('checkout hint names the verified methods and says SmartBuy takes no payment', () => {
    const daraz = getLocalStores('PK').find((s) => s.slug === 'daraz')!;
    const hint = checkoutHandoffHint(daraz, 'MacBook Air 13');
    expect(hint).toContain('Cash on Delivery');
    expect(hint).toContain('SmartBuy does not take payment');
    const ebay = getLocalStores('US').find((s) => s.slug === 'ebay')!;
    expect(checkoutHandoffHint(ebay)).toContain('not been verified');
  });
});

describe('landed cost for checkout (reuses the tax estimator)', () => {
  it('computes price + 10% placeholder duty + standard VAT + shipping', () => {
    // GB standard VAT is 20% in the estimator table.
    const result = estimateLandedCostForCheckout({
      priceUsd: 1000,
      countryCode: 'GB',
      shippingUsd: 20,
    });
    expect(result.estimate.priceUsd).toBe(1000);
    expect(result.estimate.dutyUsd).toBe(100);
    expect(result.estimate.totalUsd).toBe(1344); // (1000+100+20) * 1.2
    expect(result.dutyPct).toBe(10);
    expect(result.vatPct).toBe(20);
    expect(result.notes[0]).toContain('Estimate only');
  });

  it('returns null VAT and a manual-rate note for countries with no single rate', () => {
    const result = estimateLandedCostForCheckout({ priceUsd: 500, countryCode: 'US' });
    expect(result.vatPct).toBeNull();
    expect(result.notes.some((n) => n.includes('no single sales-tax rate'))).toBe(true);
  });

  it('says shipping is not included when no shipping figure is given', () => {
    const result = estimateLandedCostForCheckout({ priceUsd: 500, countryCode: 'GB' });
    expect(result.notes.some((n) => n.includes('Shipping is not included'))).toBe(true);
  });
});

describe('carbon label resolution (recorded first, estimate labeled)', () => {
  it('prefers the recorded footprint and ranks it against the baseline', () => {
    const label = resolveCarbonLabel({
      recordedKg: 185,
      category: 'Laptops',
      priceUsd: 999,
    });
    expect(label.kind).toBe('recorded');
    expect(label.kgCO2e).toBe(185);
    expect(label.band).toBe('A');
    expect(label.categoryBaseKg).toBe(250);
    expect(label.sourceNote).toContain('Recorded footprint');
  });

  it('falls back to a labeled estimate when nothing is recorded', () => {
    const label = resolveCarbonLabel({
      recordedKg: null,
      category: 'Laptops',
      priceUsd: 999,
    });
    expect(label.kind).toBe('estimate');
    expect(label.kgCO2e).toBeCloseTo(249.9, 1);
    expect(label.sourceNote).toContain('Estimate only — not a certified lifecycle assessment');
  });

  it('shows no number when neither recorded data nor an estimate baseline exists', () => {
    const label = resolveCarbonLabel({
      recordedKg: null,
      category: 'UnknownCategoryXYZ',
      priceUsd: null,
    });
    expect(label.kind).toBe('unknown');
    expect(label.kgCO2e).toBeNull();
    expect(label.band).toBeNull();
  });

  it('still shows a recorded value when the category has no baseline', () => {
    const label = resolveCarbonLabel({
      recordedKg: 42,
      category: 'UnknownCategoryXYZ',
      priceUsd: 100,
    });
    expect(label.kind).toBe('recorded');
    expect(label.kgCO2e).toBe(42);
    expect(label.band).toBeNull();
  });
});
