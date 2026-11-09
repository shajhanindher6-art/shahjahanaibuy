import { describe, expect, it } from 'vitest';
import {
  computeTotalOwnership,
  ownershipStorageKey,
  type OwnershipInputs,
} from '@/services/total-ownership';

function input(overrides: Partial<OwnershipInputs>): OwnershipInputs {
  return {
    basePriceUsd: 999,
    accessoriesUsd: 50,
    warrantyUsd: 99,
    maintenanceUsd: 30,
    ...overrides,
  };
}

describe('computeTotalOwnership', () => {
  it('adds base + accessories + warranty + maintenance', () => {
    const result = computeTotalOwnership(input({}));
    expect(result.extrasUsd).toBe(179);
    expect(result.totalUsd).toBe(1178);
    expect(result.basePriceUsd).toBe(999);
    expect(result.accessoriesUsd).toBe(50);
    expect(result.warrantyUsd).toBe(99);
    expect(result.maintenanceUsd).toBe(30);
  });

  it('computes the extras share of the total, rounded', () => {
    // 179 / 1178 = 15.19...% -> 15
    expect(computeTotalOwnership(input({})).extrasSharePct).toBe(15);
  });

  it('extras share is 100 when the base price is 0', () => {
    const result = computeTotalOwnership(
      input({ basePriceUsd: 0, accessoriesUsd: 100 })
    );
    expect(result.totalUsd).toBe(229);
    expect(result.extrasSharePct).toBe(100);
  });

  it('extras share is 0 when the total is 0', () => {
    const result = computeTotalOwnership(
      input({
        basePriceUsd: 0,
        accessoriesUsd: 0,
        warrantyUsd: 0,
        maintenanceUsd: 0,
      })
    );
    expect(result.totalUsd).toBe(0);
    expect(result.extrasUsd).toBe(0);
    expect(result.extrasSharePct).toBe(0);
  });

  it('zero extras means the total equals the base price', () => {
    const result = computeTotalOwnership(
      input({ accessoriesUsd: 0, warrantyUsd: 0, maintenanceUsd: 0 })
    );
    expect(result.totalUsd).toBe(999);
    expect(result.extrasUsd).toBe(0);
    expect(result.extrasSharePct).toBe(0);
  });

  it('negative inputs are treated as 0, never subtracted', () => {
    const result = computeTotalOwnership(
      input({ accessoriesUsd: -50, warrantyUsd: -10, maintenanceUsd: -5 })
    );
    expect(result.extrasUsd).toBe(0);
    expect(result.totalUsd).toBe(999);
  });

  it('NaN and Infinity inputs are treated as 0', () => {
    const result = computeTotalOwnership(
      input({
        basePriceUsd: Number.NaN,
        accessoriesUsd: Number.POSITIVE_INFINITY,
        warrantyUsd: Number.NaN,
        maintenanceUsd: Number.NEGATIVE_INFINITY,
      })
    );
    expect(result.basePriceUsd).toBe(0);
    expect(result.extrasUsd).toBe(0);
    expect(result.totalUsd).toBe(0);
    expect(result.extrasSharePct).toBe(0);
  });

  it('rounds the share instead of truncating (199/1198 = 16.6% -> 17)', () => {
    const result = computeTotalOwnership(
      input({ accessoriesUsd: 100, warrantyUsd: 99, maintenanceUsd: 0 })
    );
    // extras 199, total 1198 -> 16.61% -> 17
    expect(result.extrasUsd).toBe(199);
    expect(result.totalUsd).toBe(1198);
    expect(result.extrasSharePct).toBe(17);
  });

  it('keeps cents exactly (no hidden rounding of amounts)', () => {
    const result = computeTotalOwnership(
      input({
        basePriceUsd: 999.99,
        accessoriesUsd: 0.01,
        warrantyUsd: 0,
        maintenanceUsd: 0,
      })
    );
    expect(result.totalUsd).toBeCloseTo(1000, 10);
  });
});

describe('ownershipStorageKey', () => {
  it('namespaces the key per product slug', () => {
    expect(ownershipStorageKey('macbook-air-13')).toBe(
      'sb-ownership-macbook-air-13'
    );
    expect(ownershipStorageKey('galaxy-s24-ultra')).toBe(
      'sb-ownership-galaxy-s24-ultra'
    );
  });
});
