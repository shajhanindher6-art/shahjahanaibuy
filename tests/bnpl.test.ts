import { describe, expect, it } from 'vitest';
import {
  BNPL_METHOD_ID,
  BNPL_UNKNOWN_APR_NOTE,
  getBnplMethodForStore,
  monthlyInstalment,
} from '@/lib/local-payments';
import { getLocalStores } from '@/lib/stores';

describe('BNPL vocabulary (verified-only)', () => {
  it('exposes the bnpl id constant', () => {
    expect(BNPL_METHOD_ID).toBe('bnpl');
  });

  it('returns null for every store today — no BNPL option is verified anywhere', () => {
    for (const country of ['PK', 'IN', 'US', 'GB']) {
      for (const store of getLocalStores(country)) {
        expect(getBnplMethodForStore(store)).toBeNull();
      }
    }
  });

  it('returns the entry only when a store carries a verified bnpl method', () => {
    const store = {
      name: 'Test Store',
      slug: 'test',
      countryCode: 'US',
      websiteUrl: 'https://example.com',
      searchUrlTemplate: 'https://example.com/search?q={q}',
      paymentMethods: [
        { id: 'bnpl', label: 'Pay in instalments', verified: true },
        { id: 'cod', label: 'Cash on Delivery', verified: true },
      ],
    };
    expect(getBnplMethodForStore(store)?.label).toBe('Pay in instalments');
  });

  it('ignores an unverified bnpl entry', () => {
    const store = {
      name: 'Test Store',
      slug: 'test',
      countryCode: 'US',
      websiteUrl: 'https://example.com',
      searchUrlTemplate: 'https://example.com/search?q={q}',
      paymentMethods: [{ id: 'bnpl', label: 'Pay in instalments', verified: false }],
    };
    expect(getBnplMethodForStore(store)).toBeNull();
  });
});

describe('monthlyInstalment', () => {
  it('splits total ÷ months when the APR is unknown, with the before-interest label', () => {
    const result = monthlyInstalment(999, 12, null);
    expect(result).not.toBeNull();
    expect(result!.monthlyUsd).toBe(83.25);
    expect(result!.aprKnown).toBe(false);
    expect(result!.note).toBe(BNPL_UNKNOWN_APR_NOTE);
    expect(result!.note).toContain('retailer confirms APR at checkout');
  });

  it('treats undefined APR the same as null', () => {
    expect(monthlyInstalment(600, 6, undefined)?.monthlyUsd).toBe(100);
    expect(monthlyInstalment(600, 6, undefined)?.aprKnown).toBe(false);
  });

  it('returns total ÷ months at 0% APR', () => {
    const result = monthlyInstalment(1200, 12, 0);
    expect(result?.monthlyUsd).toBe(100);
    expect(result?.aprKnown).toBe(true);
  });

  it('amortises correctly at a known APR (12% over 12 months)', () => {
    // r = 0.01; 1200 * 0.01 / (1 - 1.01^-12) ≈ 106.62
    const result = monthlyInstalment(1200, 12, 12);
    expect(result?.monthlyUsd).toBeCloseTo(106.62, 2);
    expect(result?.aprKnown).toBe(true);
    expect(result?.note).toContain('12% APR');
  });

  it('returns null when months are missing, zero or negative', () => {
    expect(monthlyInstalment(999, null, null)).toBeNull();
    expect(monthlyInstalment(999, undefined, null)).toBeNull();
    expect(monthlyInstalment(999, 0, null)).toBeNull();
    expect(monthlyInstalment(999, -6, null)).toBeNull();
    expect(monthlyInstalment(999, Number.NaN, null)).toBeNull();
  });

  it('returns null when the total is missing, zero or negative', () => {
    expect(monthlyInstalment(null, 12, null)).toBeNull();
    expect(monthlyInstalment(0, 12, null)).toBeNull();
    expect(monthlyInstalment(-50, 12, null)).toBeNull();
  });

  it('returns null for a negative or non-finite APR — never a guessed rate', () => {
    expect(monthlyInstalment(999, 12, -5)).toBeNull();
    expect(monthlyInstalment(999, 12, Number.NaN)).toBeNull();
    expect(monthlyInstalment(999, 12, Number.POSITIVE_INFINITY)).toBeNull();
  });

  it('never invents a fee: the unknown-APR figure is exactly total ÷ months', () => {
    expect(monthlyInstalment(1000, 10, null)?.monthlyUsd).toBe(100);
    expect(monthlyInstalment(1000, 3, null)?.monthlyUsd).toBeCloseTo(333.33, 2);
  });
});
