/**
 * Section 19, Phase 2 — buying-opportunity composite badge
 * (§12 #25; task item 11).
 *
 * The badge requires ALL FOUR conditions: at/near the recorded
 * low + fresh price + validated discount + in stock. Any missing
 * condition means the badge shows NOTHING — not a weaker badge.
 * These tests pin each missing-condition case plus the qualified
 * case, against the pure service (the component renders nothing
 * unless the service qualifies, and fetches history from the
 * prices endpoint the graph already uses).
 */

import { describe, expect, it } from 'vitest';
import {
  evaluateBuyingOpportunity,
  type BuyingOpportunityInput,
} from '@/services/buying-opportunity';

const DAY_MS = 86_400_000;
const NOW = new Date('2026-11-12T12:00:00.000Z');

function at(daysAgo: number): string {
  return new Date(NOW.getTime() - daysAgo * DAY_MS).toISOString();
}

// Clean history with a real drop: 1099 → 999 (latest), no pattern.
function cleanHistory(): Array<{ price: number; recordedAt: string }> {
  return [
    { price: 1099, recordedAt: at(20) },
    { price: 1049, recordedAt: at(14) },
    { price: 999, recordedAt: at(7) },
    { price: 999, recordedAt: at(2) },
  ];
}

function qualifiedInput(overrides: Partial<BuyingOpportunityInput> = {}): BuyingOpportunityInput {
  return {
    currentPrice: 999,
    lowestPrice: 999,
    dataFreshness: at(2),
    history: cleanHistory(),
    inStock: true,
    now: NOW,
    ...overrides,
  };
}

describe('evaluateBuyingOpportunity — all four conditions', () => {
  it('qualifies when near the recorded low + fresh + validated discount + in stock', () => {
    const result = evaluateBuyingOpportunity(qualifiedInput());
    expect(result.qualifies).toBe(true);
    expect(result.nearLow).toBe(true);
    expect(result.fresh).toBe(true);
    expect(result.discountValidated).toBe(true);
    expect(result.inStock).toBe(true);
    expect(result.missing).toEqual([]);
    expect(result.evidence).toContain('$999');
    expect(result.evidence).toContain('in stock');
  });

  it('shows nothing when the price is NOT near the recorded low', () => {
    const result = evaluateBuyingOpportunity(
      qualifiedInput({ currentPrice: 1099, lowestPrice: 999 })
    );
    expect(result.qualifies).toBe(false);
    expect(result.nearLow).toBe(false);
    expect(result.missing.some((m) => m.includes('more than 5% above'))).toBe(true);
    expect(result.evidence).toBeNull();
  });

  it('shows nothing when the price is stale', () => {
    const result = evaluateBuyingOpportunity(
      qualifiedInput({ dataFreshness: at(10) })
    );
    expect(result.qualifies).toBe(false);
    expect(result.fresh).toBe(false);
    expect(result.missing.some((m) => m.includes('10 days ago'))).toBe(true);
    expect(result.evidence).toBeNull();
  });

  it('shows nothing when the price age is unknown', () => {
    const result = evaluateBuyingOpportunity(
      qualifiedInput({ dataFreshness: null })
    );
    expect(result.qualifies).toBe(false);
    expect(result.fresh).toBe(false);
    expect(result.missing.some((m) => m.includes('age unknown'))).toBe(true);
  });

  it('shows nothing when the discount cannot be validated (too little history)', () => {
    const result = evaluateBuyingOpportunity(
      qualifiedInput({ history: [{ price: 999, recordedAt: at(2) }] })
    );
    expect(result.qualifies).toBe(false);
    expect(result.discountValidated).toBe(false);
    expect(result.missing.some((m) => m.includes('Not enough recorded price history'))).toBe(true);
  });

  it('shows nothing when the history carries a fake-discount pattern', () => {
    const result = evaluateBuyingOpportunity(
      qualifiedInput({
        history: [
          { price: 900, recordedAt: at(20) },
          { price: 1100, recordedAt: at(10) },
          { price: 999, recordedAt: at(2) },
        ],
      })
    );
    expect(result.qualifies).toBe(false);
    expect(result.discountValidated).toBe(false);
    expect(result.missing.some((m) => m.includes('Discount not validated'))).toBe(true);
  });

  it('shows nothing when there is no real drop from the peak (flat series, no discount to validate)', () => {
    const result = evaluateBuyingOpportunity(
      qualifiedInput({
        history: [
          { price: 999, recordedAt: at(20) },
          { price: 999, recordedAt: at(2) },
        ],
      })
    );
    expect(result.qualifies).toBe(false);
    expect(result.discountValidated).toBe(false);
  });

  it('shows nothing when out of stock', () => {
    const result = evaluateBuyingOpportunity(qualifiedInput({ inStock: false }));
    expect(result.qualifies).toBe(false);
    expect(result.inStock).toBe(false);
    expect(result.missing.some((m) => m.includes('Out of stock'))).toBe(true);
  });

  it('shows nothing when the current or lowest price is missing', () => {
    expect(evaluateBuyingOpportunity(qualifiedInput({ currentPrice: null })).qualifies).toBe(false);
    expect(evaluateBuyingOpportunity(qualifiedInput({ lowestPrice: null })).qualifies).toBe(false);
  });
});
