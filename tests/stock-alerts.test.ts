import { describe, expect, it } from 'vitest';
import {
  shouldRecordAvailabilitySnapshot,
  isBackInStockTransition,
  type AvailabilitySnapshot,
} from '@/lib/local-alerts';

// S3#3 — stock alerts: availability is recorded per refresh like
// price history (availability_history, migration 026), and a
// back-in-stock alert fires only on a genuine out→in transition.
// These pure decision helpers are what the refresh route uses, so
// the trigger rules are provable here without a database.

const inStock = (price: number | null = 999): AvailabilitySnapshot => ({
  availability: 'in_stock',
  inStock: true,
  price,
});

const outOfStock = (price: number | null = 999): AvailabilitySnapshot => ({
  availability: 'out_of_stock',
  inStock: false,
  price,
});

describe('shouldRecordAvailabilitySnapshot', () => {
  it('records the first snapshot when there is no previous row', () => {
    expect(shouldRecordAvailabilitySnapshot(null, inStock())).toBe(true);
    expect(shouldRecordAvailabilitySnapshot(null, outOfStock())).toBe(true);
  });

  it('skips unchanged snapshots so history shows no fake fluctuations', () => {
    expect(shouldRecordAvailabilitySnapshot(inStock(999), inStock(999))).toBe(false);
    expect(shouldRecordAvailabilitySnapshot(outOfStock(999), outOfStock(999))).toBe(false);
  });

  it('records availability changes and price changes', () => {
    expect(shouldRecordAvailabilitySnapshot(outOfStock(), inStock())).toBe(true);
    expect(shouldRecordAvailabilitySnapshot(inStock(), outOfStock())).toBe(true);
    expect(shouldRecordAvailabilitySnapshot(inStock(999), inStock(899))).toBe(true);
  });

  it('records a price appearing or disappearing', () => {
    expect(shouldRecordAvailabilitySnapshot(inStock(null), inStock(999))).toBe(true);
    expect(shouldRecordAvailabilitySnapshot(inStock(999), inStock(null))).toBe(true);
  });
});

describe('isBackInStockTransition', () => {
  it('is true only on out-of-stock → in-stock', () => {
    expect(isBackInStockTransition(outOfStock(), inStock())).toBe(true);
  });

  it('is false for a first sighting, steady stock, and going out of stock', () => {
    // A product seen in stock for the first time is not "back" —
    // there is no recorded out-of-stock state to return from.
    expect(isBackInStockTransition(null, inStock())).toBe(false);
    expect(isBackInStockTransition(inStock(), inStock())).toBe(false);
    expect(isBackInStockTransition(inStock(), outOfStock())).toBe(false);
    expect(isBackInStockTransition(outOfStock(), outOfStock())).toBe(false);
    expect(isBackInStockTransition(null, outOfStock())).toBe(false);
  });
});
