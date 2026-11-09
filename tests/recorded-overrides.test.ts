/**
 * Tests for the recorded-overrides engine (Option 19).
 * Pure math + sanitization — no DB, no network. The fail-safe DB
 * read is covered by the same pattern as repairability/endurance/
 * physical (all nulls on error).
 */
import { describe, it, expect } from 'vitest';
import {
  sanitizeAnnualRate,
  monthlyDeclinePctFromAnnualRate,
} from '@/services/recorded-overrides';

describe('sanitizeAnnualRate', () => {
  it('accepts a fraction in [0, 1]', () => {
    expect(sanitizeAnnualRate(0)).toBe(0);
    expect(sanitizeAnnualRate(0.12)).toBe(0.12);
    expect(sanitizeAnnualRate(1)).toBe(1);
  });

  it('accepts a numeric string', () => {
    expect(sanitizeAnnualRate('0.15')).toBe(0.15);
  });

  it('rejects anything outside [0, 1]', () => {
    expect(sanitizeAnnualRate(1.01)).toBeNull();
    expect(sanitizeAnnualRate(-0.1)).toBeNull();
    expect(sanitizeAnnualRate(12)).toBeNull();
  });

  it('rejects non-finite and non-numeric values', () => {
    expect(sanitizeAnnualRate(NaN)).toBeNull();
    expect(sanitizeAnnualRate(Infinity)).toBeNull();
    expect(sanitizeAnnualRate('abc')).toBeNull();
    expect(sanitizeAnnualRate(null)).toBeNull();
    expect(sanitizeAnnualRate(undefined)).toBeNull();
  });
});

describe('monthlyDeclinePctFromAnnualRate', () => {
  it('converts 12%/year to 1%/month', () => {
    expect(monthlyDeclinePctFromAnnualRate(0.12)).toBe(1);
  });

  it('converts 15%/year to 1.25%/month', () => {
    expect(monthlyDeclinePctFromAnnualRate(0.15)).toBe(1.25);
  });

  it('converts a 0% rate to 0%/month', () => {
    expect(monthlyDeclinePctFromAnnualRate(0)).toBe(0);
  });

  it('returns null when no valid recorded rate is supplied', () => {
    expect(monthlyDeclinePctFromAnnualRate(null)).toBeNull();
    expect(monthlyDeclinePctFromAnnualRate(undefined)).toBeNull();
    expect(monthlyDeclinePctFromAnnualRate(1.5)).toBeNull();
  });
});
