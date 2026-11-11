/**
 * Unit tests for the deals-page list helpers (Section 14, Chunk 4
 * — B7 pagination, B9 coupon sort, B14 min-discount filter).
 */

import { describe, expect, it } from 'vitest';
import {
  filterDealsByMinDiscount,
  paginateList,
  sortCoupons,
} from '@/lib/deal-list';

describe('paginateList', () => {
  const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];

  it('returns the requested page slice', () => {
    expect(paginateList(items, 1, 12)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(paginateList(items, 2, 12)).toEqual([13]);
  });

  it('returns [] past the end, and clamps page below 1 to page 1', () => {
    expect(paginateList(items, 3, 12)).toEqual([]);
    expect(paginateList(items, 0, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(paginateList([], 1, 12)).toEqual([]);
  });
});

describe('sortCoupons', () => {
  const coupons = [
    { code: 'A', discountValue: 10, validUntil: '2026-12-31' },
    { code: 'B', discountValue: 25, validUntil: null },
    { code: 'C', discountValue: 15, validUntil: '2026-11-20' },
  ];

  it('sorts by listed discount value for discount/savings', () => {
    expect(sortCoupons(coupons, 'discount').map((c) => c.code)).toEqual(['B', 'C', 'A']);
    expect(sortCoupons(coupons, 'savings').map((c) => c.code)).toEqual(['B', 'C', 'A']);
  });

  it('sorts by expiry soonest-first, no-expiry last', () => {
    expect(sortCoupons(coupons, 'ending').map((c) => c.code)).toEqual(['C', 'A', 'B']);
  });

  it('keeps fetched order for ai sort', () => {
    expect(sortCoupons(coupons, 'ai').map((c) => c.code)).toEqual(['A', 'B', 'C']);
  });
});

describe('filterDealsByMinDiscount', () => {
  const deals = [
    { id: 'a', discountPercentage: 10 },
    { id: 'b', discountPercentage: 25 },
    { id: 'c', discountPercentage: 30 },
  ];

  it('keeps only deals at or above the minimum', () => {
    expect(filterDealsByMinDiscount(deals, 20).map((d) => d.id)).toEqual(['b', 'c']);
    expect(filterDealsByMinDiscount(deals, 30).map((d) => d.id)).toEqual(['c']);
  });

  it('passes everything through with no minimum', () => {
    expect(filterDealsByMinDiscount(deals, null)).toEqual(deals);
    expect(filterDealsByMinDiscount(deals, 0)).toEqual(deals);
  });
});
