import { describe, expect, it } from 'vitest';
import { calculateEmi, parseEmiParams } from '@/lib/emi-calculator';

describe('calculateEmi', () => {
  it('$999 at 12% over 12 months → ≈ $88.76/month', () => {
    const result = calculateEmi(999, 12, 12);
    expect(result?.monthlyEmi).toBeCloseTo(88.76, 2);
    expect(result?.totalPayable).toBeCloseTo(1065.12, 2);
    expect(result?.totalInterest).toBeCloseTo(66.12, 2);
  });

  it('0% rate splits the principal evenly', () => {
    const result = calculateEmi(1200, 0, 12);
    expect(result?.monthlyEmi).toBe(100);
    expect(result?.totalPayable).toBe(1200);
    expect(result?.totalInterest).toBe(0);
  });

  it('longer tenure lowers the installment but raises total interest', () => {
    const short = calculateEmi(1200, 12, 12);
    const long = calculateEmi(1200, 12, 24);
    expect(long?.monthlyEmi).toBeLessThan(short?.monthlyEmi ?? 0);
    expect(long?.totalInterest).toBeGreaterThan(short?.totalInterest ?? 0);
  });

  it('total payable always equals EMI × tenure', () => {
    const result = calculateEmi(54321, 18.5, 36);
    expect(result).not.toBeNull();
    expect(result?.totalPayable).toBeCloseTo(
      (result?.monthlyEmi ?? 0) * 36,
      2
    );
    expect(result?.totalInterest).toBeCloseTo(
      (result?.totalPayable ?? 0) - 54321,
      2
    );
  });

  it('rejects invalid inputs — no preset rate exists to fall back to', () => {
    expect(calculateEmi(0, 12, 12)).toBeNull();
    expect(calculateEmi(-100, 12, 12)).toBeNull();
    expect(calculateEmi(1000, -1, 12)).toBeNull();
    expect(calculateEmi(1000, 101, 12)).toBeNull();
    expect(calculateEmi(1000, 12, 0)).toBeNull();
    expect(calculateEmi(1000, 12, 361)).toBeNull();
    expect(calculateEmi(1000, 12, 12.5)).toBeNull();
    expect(calculateEmi(1000, NaN, 12)).toBeNull();
  });
});

describe('parseEmiParams', () => {
  it('parses a full query', () => {
    expect(parseEmiParams({ price: '999', rate: '12', months: '12' })).toEqual({
      price: 999,
      rate: 12,
      months: 12,
      errors: [],
      hasQuery: true,
    });
  });

  it('a missing rate errors and says no rate is preset', () => {
    const parsed = parseEmiParams({ price: '999', months: '12' });
    expect(parsed.rate).toBeNull();
    expect(parsed.errors.join(' ')).toMatch(/no rate is preset/);
  });

  it('a fractional tenure errors', () => {
    const parsed = parseEmiParams({ price: '999', rate: '12', months: '12.5' });
    expect(parsed.errors.join(' ')).toMatch(/whole number/);
  });

  it('empty params give no errors', () => {
    const parsed = parseEmiParams({});
    expect(parsed.hasQuery).toBe(false);
    expect(parsed.errors).toEqual([]);
  });
});
