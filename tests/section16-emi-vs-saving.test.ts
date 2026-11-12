import { describe, expect, it } from 'vitest';
import { compareEmiVsSaving, parseEmiVsSavingParams } from '@/lib/emi-vs-saving';

describe('compareEmiVsSaving', () => {
  it('$999 at 12% over 12 months: EMI $88.76/mo, total $1,065.12; saving the same amount costs $999', () => {
    const c = compareEmiVsSaving({ price: 999, annualRatePercent: 12, tenureMonths: 12 });
    expect(c?.emi.monthlyEmi).toBeCloseTo(88.76, 2);
    expect(c?.emi.totalPayable).toBeCloseTo(1065.12, 2);
    expect(c?.emi.totalInterest).toBeCloseTo(66.12, 2);
    // Default saving = the EMI installment itself.
    expect(c?.monthlySavingUsd).toBeCloseTo(88.76, 2);
    expect(c?.monthsToSave).toBe(12);
    expect(c?.savingTotalUsd).toBe(999);
    expect(c?.interestSavedUsd).toBeCloseTo(66.12, 2);
    expect(c?.monthsSoonerWithEmi).toBe(12);
  });

  it('saving $200/mo buys the $999 product outright in 5 months', () => {
    const c = compareEmiVsSaving({
      price: 999,
      annualRatePercent: 12,
      tenureMonths: 12,
      monthlySavingUsd: 200,
    });
    expect(c?.monthsToSave).toBe(5);
    expect(c?.interestSavedUsd).toBeCloseTo(66.12, 2);
  });

  it('at 0% both paths cost the same — only timing differs', () => {
    const c = compareEmiVsSaving({ price: 1200, annualRatePercent: 0, tenureMonths: 12 });
    expect(c?.emi.totalPayable).toBe(1200);
    expect(c?.interestSavedUsd).toBe(0);
    expect(c?.monthsToSave).toBe(12);
  });

  it('longer tenure raises the interest saved by waiting', () => {
    const short = compareEmiVsSaving({ price: 1200, annualRatePercent: 12, tenureMonths: 12 });
    const long = compareEmiVsSaving({ price: 1200, annualRatePercent: 12, tenureMonths: 24 });
    expect(long?.interestSavedUsd).toBeGreaterThan(short?.interestSavedUsd ?? 0);
  });

  it('rejects invalid inputs — no rate is ever preset', () => {
    expect(compareEmiVsSaving({ price: 0, annualRatePercent: 12, tenureMonths: 12 })).toBeNull();
    expect(compareEmiVsSaving({ price: 999, annualRatePercent: 101, tenureMonths: 12 })).toBeNull();
    expect(compareEmiVsSaving({ price: 999, annualRatePercent: 12, tenureMonths: 0 })).toBeNull();
    expect(
      compareEmiVsSaving({ price: 999, annualRatePercent: 12, tenureMonths: 12, monthlySavingUsd: 0 })
    ).toBeNull();
  });
});

describe('parseEmiVsSavingParams', () => {
  it('parses a full query, saving optional', () => {
    expect(
      parseEmiVsSavingParams({ price: '999', rate: '12', months: '12' })
    ).toEqual({ price: 999, rate: 12, months: 12, saving: null, errors: [], hasQuery: true });
    expect(
      parseEmiVsSavingParams({ price: '999', rate: '12', months: '12', saving: '200' }).saving
    ).toBe(200);
  });

  it('flags a missing rate (no preset exists to fall back to)', () => {
    const p = parseEmiVsSavingParams({ price: '999', months: '12' });
    expect(p.errors.join(' ')).toContain('interest rate');
  });
});
