import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  lowestPrice,
  ownershipExtrasFor,
} from '@/components/comparison/compare-value-checks';

describe('lowestPrice', () => {
  it('returns the minimum finite positive price', () => {
    expect(lowestPrice([1099, 999, 1018.98])).toBe(999);
  });

  it('ignores null, zero, negative and non-finite prices', () => {
    expect(lowestPrice([null, 0, -5, Number.NaN, 499])).toBe(499);
  });

  it('returns null when no priced retailer exists', () => {
    expect(lowestPrice([null, undefined, 0])).toBeNull();
    expect(lowestPrice([])).toBeNull();
  });
});

describe('ownershipExtrasFor', () => {
  const store = new Map<string, string>();

  beforeEach(() => {
    store.clear();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
      removeItem: (k: string) => {
        store.delete(k);
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns zeros when nothing is saved', () => {
    expect(ownershipExtrasFor('macbook-air-13')).toEqual({
      accessoriesUsd: 0,
      warrantyUsd: 0,
      maintenanceUsd: 0,
    });
  });

  it('reads saved extras for the product slug', () => {
    store.set(
      'sb-ownership-macbook-air-13',
      JSON.stringify({ accessories: 49.99, warranty: 129, maintenance: 0 })
    );
    expect(ownershipExtrasFor('macbook-air-13')).toEqual({
      accessoriesUsd: 49.99,
      warrantyUsd: 129,
      maintenanceUsd: 0,
    });
  });

  it('returns zeros on corrupt JSON and on negative values', () => {
    store.set('sb-ownership-a', 'not-json{');
    expect(ownershipExtrasFor('a')).toEqual({
      accessoriesUsd: 0,
      warrantyUsd: 0,
      maintenanceUsd: 0,
    });
    store.set(
      'sb-ownership-b',
      JSON.stringify({ accessories: -10, warranty: 'x', maintenance: 25 })
    );
    expect(ownershipExtrasFor('b')).toEqual({
      accessoriesUsd: 0,
      warrantyUsd: 0,
      maintenanceUsd: 25,
    });
  });
});
