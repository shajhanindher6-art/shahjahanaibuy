import { describe, expect, it } from 'vitest';
import {
  computeCostPerHour,
  computeDailyCost,
  formatCostPerHour,
  labelForCostPerHour,
  monthlySavingTarget,
} from '@/lib/analytics/costPerHour';

describe('computeCostPerHour', () => {
  it('divides total ownership by 3 years x 365 days x daily hours', () => {
    const result = computeCostPerHour({ totalOwnershipUsd: 999, dailyHours: 6 });
    // 999 / (3 * 365 * 6) = 999 / 6570 = 0.1520... -> 0.15
    expect(result.costPerHourUsd).toBe(0.15);
    expect(result.dailyCostUsd).toBe(0.91);
    expect(result.status).toBe('ok');
  });

  it('returns not-enough-data without a price or daily hours', () => {
    expect(
      computeCostPerHour({ totalOwnershipUsd: null, dailyHours: 6 })
    ).toEqual({ costPerHourUsd: null, dailyCostUsd: null, status: 'not-enough-data' });
    expect(
      computeCostPerHour({ totalOwnershipUsd: 999, dailyHours: 0 })
    ).toEqual({ costPerHourUsd: null, dailyCostUsd: null, status: 'not-enough-data' });
  });
});

describe('formatCostPerHour and labelForCostPerHour', () => {
  it('formats $0.46 as "$0.46 / active hour"', () => {
    expect(formatCostPerHour(0.46)).toBe('$0.46 / active hour');
    expect(formatCostPerHour(null)).toBe('—');
  });

  it('labels hourly costs against coffee and chai', () => {
    expect(labelForCostPerHour(0.15)).toBe('Cheaper than a cup of chai');
    expect(labelForCostPerHour(0.46)).toBe('Cheaper than daily coffee');
    expect(labelForCostPerHour(0.75)).toBe('About the price of a coffee an hour');
    expect(labelForCostPerHour(2.5)).toBe(
      'Premium hourly cost — only worth it with heavy daily use'
    );
    expect(labelForCostPerHour(null)).toBe('Hourly cost not available yet');
  });
});

describe('computeDailyCost', () => {
  it('divides price by lifespan years x 365', () => {
    // 999 / (5 * 365) = 0.547... -> 0.55
    expect(computeDailyCost({ priceUsd: 999, lifespanYears: 5 })).toBe(0.55);
    expect(computeDailyCost({ priceUsd: null, lifespanYears: 5 })).toBeNull();
    expect(computeDailyCost({ priceUsd: 999, lifespanYears: null })).toBeNull();
  });
});

describe('monthlySavingTarget', () => {
  it('divides price by months', () => {
    expect(monthlySavingTarget({ priceUsd: 999, months: 12 })).toBe(83.25);
    expect(monthlySavingTarget({ priceUsd: 999, months: 0 })).toBeNull();
    expect(monthlySavingTarget({ priceUsd: null, months: 12 })).toBeNull();
  });
});
