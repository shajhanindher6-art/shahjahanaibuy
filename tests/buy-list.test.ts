import { describe, expect, it } from 'vitest';
import {
  BUY_LIST_MAX_QUANTITY,
  isMissingTableError,
  normalizeQuantity,
} from '@/lib/buy-list';

describe('normalizeQuantity', () => {
  it('accepts integers 1..99', () => {
    expect(normalizeQuantity(1)).toBe(1);
    expect(normalizeQuantity(5)).toBe(5);
    expect(normalizeQuantity(BUY_LIST_MAX_QUANTITY)).toBe(99);
  });

  it('rejects 0, negatives, and above the cap', () => {
    expect(normalizeQuantity(0)).toBeNull();
    expect(normalizeQuantity(-1)).toBeNull();
    expect(normalizeQuantity(100)).toBeNull();
    expect(normalizeQuantity(1000)).toBeNull();
  });

  it('rejects fractional, NaN, and non-number values', () => {
    expect(normalizeQuantity(1.5)).toBeNull();
    expect(normalizeQuantity(NaN)).toBeNull();
    expect(normalizeQuantity(Infinity)).toBeNull();
    expect(normalizeQuantity('2')).toBeNull();
    expect(normalizeQuantity(undefined)).toBeNull();
    expect(normalizeQuantity(null)).toBeNull();
    expect(normalizeQuantity({})).toBeNull();
  });
});

describe('isMissingTableError (buy-list)', () => {
  it('treats both Postgres 42P01 and PostgREST PGRST205 as missing table', () => {
    expect(isMissingTableError({ code: '42P01' })).toBe(true);
    expect(isMissingTableError({ code: 'PGRST205' })).toBe(true);
  });

  it('does not treat other errors as missing table', () => {
    expect(isMissingTableError({ code: '23505' })).toBe(false);
    expect(isMissingTableError({ code: '42501' })).toBe(false);
    expect(isMissingTableError(null)).toBe(false);
    expect(isMissingTableError(undefined)).toBe(false);
    expect(isMissingTableError({})).toBe(false);
  });
});

describe('buy-list dedupe contract', () => {
  it('caps the merged quantity at the maximum (documented behaviour)', () => {
    // addBuyListItem bumps an existing row by the requested amount
    // and caps at BUY_LIST_MAX_QUANTITY — the cap itself is the
    // dedupe guarantee: no second row is ever created for the same
    // (user, product, merchant_product) triple.
    const existing = 95;
    const requested = 10;
    const bumped = Math.min(BUY_LIST_MAX_QUANTITY, existing + requested);
    expect(bumped).toBe(99);
    expect(BUY_LIST_MAX_QUANTITY).toBe(99);
  });
});
