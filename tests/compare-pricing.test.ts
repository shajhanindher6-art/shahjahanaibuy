/**
 * Unit tests for the comparison-matrix pricing helpers (Section 14,
 * Chunk 4 — B10 best discount, B11 price gap, B15 price range).
 */

import { describe, expect, it } from 'vitest';
import {
  bestDiscount,
  formatUsd,
  lowestRetailerPrice,
  priceGapLabel,
  priceRangeLabel,
} from '@/lib/compare-pricing';

describe('formatUsd', () => {
  it('formats money with two decimals', () => {
    expect(formatUsd(999)).toBe('$999.00');
    expect(formatUsd(20.5)).toBe('$20.50');
  });
});

describe('bestDiscount', () => {
  it('takes the largest listed discount', () => {
    expect(
      bestDiscount([{ discount: 10 }, { discount: 20 }, { discount: null }])
    ).toBe(20);
  });

  it('returns null when no retailer lists a discount', () => {
    expect(bestDiscount([{ discount: null }, { discount: null }])).toBeNull();
    expect(bestDiscount([])).toBeNull();
    expect(bestDiscount([{ discount: 0 }])).toBeNull();
  });
});

describe('lowestRetailerPrice', () => {
  it('takes the min, or null with no listings', () => {
    expect(lowestRetailerPrice([1099, 999, 1019])).toBe(999);
    expect(lowestRetailerPrice([])).toBeNull();
  });
});

describe('priceGapLabel', () => {
  it('labels the cheapest product "Cheapest"', () => {
    expect(priceGapLabel(999, 999)).toBe('Cheapest');
  });

  it('shows the dollar gap above the cheapest', () => {
    expect(priceGapLabel(1099, 999)).toBe('+$100.00 vs cheapest');
    expect(priceGapLabel(1019.5, 999)).toBe('+$20.50 vs cheapest');
  });

  it('returns null when either side has no price', () => {
    expect(priceGapLabel(null, 999)).toBeNull();
    expect(priceGapLabel(1099, null)).toBeNull();
  });
});

describe('priceRangeLabel', () => {
  it('shows a range across retailers', () => {
    expect(priceRangeLabel([999, 1019])).toBe('$999.00 – $1,019.00');
  });

  it('shows a single price when all listings agree', () => {
    expect(priceRangeLabel([999, 999])).toBe('$999.00');
  });

  it('returns null with no listings', () => {
    expect(priceRangeLabel([])).toBeNull();
  });
});
