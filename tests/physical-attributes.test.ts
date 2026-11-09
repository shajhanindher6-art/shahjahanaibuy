/**
 * Tests for the physical-attributes engine (Option 18).
 * Pure math — no DB, no network. The fail-safe DB read is covered
 * by the same pattern as repairability/endurance (all nulls on error).
 */
import { describe, it, expect } from 'vitest';
import {
  computeAnnualEnergyKwh,
  computeAnnualCost,
  heavyItemNote,
  HEAVY_ITEM_WEIGHT_KG,
  DAILY_USE_HOURS,
} from '@/services/physical-attributes';

describe('computeAnnualEnergyKwh', () => {
  it('computes kWh/year at 8h/day: 65W -> 189.8 kWh', () => {
    expect(computeAnnualEnergyKwh(65)).toBe(189.8);
  });

  it('computes kWh/year for a 100W device: 292 kWh', () => {
    expect(computeAnnualEnergyKwh(100)).toBe(292);
  });

  it('returns 0 for 0W', () => {
    expect(computeAnnualEnergyKwh(0)).toBe(0);
  });

  it('returns null when power draw is not recorded', () => {
    expect(computeAnnualEnergyKwh(null)).toBeNull();
  });

  it('returns null for negative or non-finite watts', () => {
    expect(computeAnnualEnergyKwh(-10)).toBeNull();
    expect(computeAnnualEnergyKwh(NaN)).toBeNull();
    expect(computeAnnualEnergyKwh(Infinity)).toBeNull();
  });

  it('uses the stated 8h/day assumption', () => {
    expect(DAILY_USE_HOURS).toBe(8);
  });
});

describe('computeAnnualCost', () => {
  it('computes cost only from a shopper-supplied tariff', () => {
    // 65W -> 189.8 kWh/year; at $0.15/kWh -> $28.47/year.
    expect(computeAnnualCost(65, 0.15)).toBe(28.47);
  });

  it('returns null when no tariff is supplied — never assumes one', () => {
    expect(computeAnnualCost(65, null)).toBeNull();
  });

  it('returns null when power draw is not recorded', () => {
    expect(computeAnnualCost(null, 0.15)).toBeNull();
  });

  it('returns null for a negative tariff', () => {
    expect(computeAnnualCost(65, -0.5)).toBeNull();
  });
});

describe('heavyItemNote', () => {
  it('flags a 10 kg item as heavy (boundary inclusive)', () => {
    expect(heavyItemNote(HEAVY_ITEM_WEIGHT_KG)).toMatch(/Heavy item/);
  });

  it('flags a heavier item', () => {
    expect(heavyItemNote(25.5)).toMatch(/check shipping/);
  });

  it('does not flag a 9.99 kg item', () => {
    expect(heavyItemNote(9.99)).toBeNull();
  });

  it('returns null when weight is not recorded', () => {
    expect(heavyItemNote(null)).toBeNull();
  });
});
