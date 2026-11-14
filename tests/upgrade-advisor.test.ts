import { describe, expect, it } from 'vitest';
import {
  calculateCostPerYear,
  decideUpgrade,
  findSameCategorySuccessors,
  parseUpgradeAdvisorParams,
  RESALE_PROJECTION_LABEL,
  SUCCESSOR_PRICE_STALE_LABEL,
} from '@/lib/upgrade-advisor';

describe('calculateCostPerYear', () => {
  it('$1000 paid in 2021 is $250/year in 2025', () => {
    expect(calculateCostPerYear(1000, 2021, 2025)).toBe(250);
  });

  it('bought this year counts as 1 year (full price is the first-year cost)', () => {
    expect(calculateCostPerYear(999, 2025, 2025)).toBe(999);
  });

  it('rejects a future purchase year, a pre-1990 year, and a non-positive price', () => {
    expect(calculateCostPerYear(999, 2026, 2025)).toBeNull();
    expect(calculateCostPerYear(999, 1989, 2025)).toBeNull();
    expect(calculateCostPerYear(0, 2021, 2025)).toBeNull();
    expect(calculateCostPerYear(-50, 2021, 2025)).toBeNull();
  });
});

describe('decideUpgrade verdict tiers', () => {
  it('Keep: owned less than 2 years — not amortized yet', () => {
    const advice = decideUpgrade({
      pricePaid: 1200,
      purchaseYear: 2024,
      currentYear: 2025,
      successorPrice: 999,
      resaleProjectedValue: null,
    });
    expect(advice?.verdict).toBe('keep');
    expect(advice?.yearsOwned).toBe(1);
    expect(advice?.costPerYear).toBe(1200);
    expect(advice?.netUpgradeCost).toBe(999);
  });

  it('Upgrade: owned 4 years and net cost is ~1 year of cost-per-year', () => {
    const advice = decideUpgrade({
      pricePaid: 1200,
      purchaseYear: 2021,
      currentYear: 2025,
      successorPrice: 500,
      resaleProjectedValue: 200,
    });
    expect(advice?.verdict).toBe('upgrade');
    expect(advice?.costPerYear).toBe(300);
    expect(advice?.netUpgradeCost).toBe(300);
    expect(advice?.yearsToBreakEven).toBe(1);
  });

  it('Wait: break-even between 2 and 4 years of cost-per-year', () => {
    const advice = decideUpgrade({
      pricePaid: 1200,
      purchaseYear: 2021,
      currentYear: 2025,
      successorPrice: 1200,
      resaleProjectedValue: 300,
    });
    expect(advice?.verdict).toBe('wait');
    expect(advice?.netUpgradeCost).toBe(900);
    expect(advice?.yearsToBreakEven).toBe(3);
  });

  it('Keep: break-even beyond 4 years of cost-per-year', () => {
    const advice = decideUpgrade({
      pricePaid: 1000,
      purchaseYear: 2020,
      currentYear: 2025,
      successorPrice: 2000,
      resaleProjectedValue: null,
    });
    expect(advice?.verdict).toBe('keep');
    expect(advice?.yearsToBreakEven).toBe(10);
  });

  it('Wait: no recorded successor price — the upgrade cost cannot be computed', () => {
    const advice = decideUpgrade({
      pricePaid: 1000,
      purchaseYear: 2020,
      currentYear: 2025,
      successorPrice: null,
      resaleProjectedValue: null,
    });
    expect(advice?.verdict).toBe('wait');
    expect(advice?.netUpgradeCost).toBeNull();
    expect(advice?.yearsToBreakEven).toBeNull();
  });

  it('Upgrade: projected resale covers the successor price (net cost ≤ $0)', () => {
    const advice = decideUpgrade({
      pricePaid: 1000,
      purchaseYear: 2022,
      currentYear: 2025,
      successorPrice: 400,
      resaleProjectedValue: 450,
    });
    expect(advice?.verdict).toBe('upgrade');
    expect(advice?.netUpgradeCost).toBe(-50);
  });

  it('returns null for invalid inputs', () => {
    expect(
      decideUpgrade({
        pricePaid: 1000,
        purchaseYear: 2026,
        currentYear: 2025,
        successorPrice: 500,
        resaleProjectedValue: null,
      })
    ).toBeNull();
  });

  it('never quotes a trade-in: labels say PROJECTION and STALE, never guaranteed', () => {
    expect(RESALE_PROJECTION_LABEL).toContain('PROJECTION');
    expect(RESALE_PROJECTION_LABEL).toContain('Not a resale quote');
    expect(RESALE_PROJECTION_LABEL).toContain('No trade-in value is recorded');
    expect(SUCCESSOR_PRICE_STALE_LABEL).toContain('STALE');
  });
});

describe('findSameCategorySuccessors', () => {
  const products = [
    { slug: 'a', name: 'A', brand: 'X', category: 'Laptops' },
    { slug: 'b', name: 'B', brand: 'Y', category: 'Phones' },
    { slug: 'c', name: 'C', brand: 'X', category: 'laptops' },
    { slug: 'd', name: 'D', brand: 'Z', category: null },
  ];

  it('matches case-insensitively on the recorded category text', () => {
    expect(findSameCategorySuccessors(products, 'Laptops').map((p) => p.slug)).toEqual([
      'a',
      'c',
    ]);
  });

  it('returns an empty list for an empty category or no match', () => {
    expect(findSameCategorySuccessors(products, '')).toEqual([]);
    expect(findSameCategorySuccessors(products, 'Tablets')).toEqual([]);
  });
});

describe('parseUpgradeAdvisorParams', () => {
  it('parses a full query', () => {
    const parsed = parseUpgradeAdvisorParams({
      brand: 'Apple',
      category: 'Laptops',
      year: '2021',
      price: '1,200',
      current: 'macbook-air-13',
      successor: 'dell-xps-13',
    });
    expect(parsed.brand).toBe('Apple');
    expect(parsed.category).toBe('Laptops');
    expect(parsed.purchaseYear).toBe(2021);
    expect(parsed.pricePaid).toBe(1200);
    expect(parsed.currentSlug).toBe('macbook-air-13');
    expect(parsed.successorSlug).toBe('dell-xps-13');
    expect(parsed.yearError).toBeNull();
    expect(parsed.priceError).toBeNull();
  });

  it('flags a future year and a non-positive price', () => {
    const parsed = parseUpgradeAdvisorParams({ year: '2099', price: '-5' });
    expect(parsed.purchaseYear).toBeNull();
    expect(parsed.pricePaid).toBeNull();
    expect(parsed.yearError).toContain('not a valid purchase year');
    expect(parsed.priceError).toContain('not a valid price');
  });
});
