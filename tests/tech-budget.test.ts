import { describe, expect, it } from 'vitest';
import {
  budgetStatus,
  sanitizeTechBudget,
  DEFAULT_MONTHLY_TECH_BUDGET_USD,
  DEFAULT_DAILY_TARGET_HOURS,
} from '@/services/tech-budget';

describe('sanitizeTechBudget', () => {
  it('falls back to defaults for missing or invalid inputs', () => {
    expect(sanitizeTechBudget({})).toEqual({
      monthlyTechBudgetUsd: DEFAULT_MONTHLY_TECH_BUDGET_USD,
      dailyTargetHours: DEFAULT_DAILY_TARGET_HOURS,
    });
    expect(sanitizeTechBudget({ monthlyTechBudgetUsd: -5, dailyTargetHours: 0 })).toEqual({
      monthlyTechBudgetUsd: DEFAULT_MONTHLY_TECH_BUDGET_USD,
      dailyTargetHours: DEFAULT_DAILY_TARGET_HOURS,
    });
  });

  it('keeps valid user inputs', () => {
    expect(
      sanitizeTechBudget({ monthlyTechBudgetUsd: 500, dailyTargetHours: 4 })
    ).toEqual({ monthlyTechBudgetUsd: 500, dailyTargetHours: 4 });
  });
});

describe('budgetStatus', () => {
  it('computes remaining budget and coverage inside budget', () => {
    const status = budgetStatus({ monthlyBudgetUsd: 1000, wishlistTotalUsd: 999 });
    expect(status.remainingUsd).toBe(1);
    expect(status.overBudget).toBe(false);
    expect(status.coveragePct).toBe(100);
  });

  it('flags a wishlist total above the monthly budget', () => {
    const status = budgetStatus({ monthlyBudgetUsd: 1000, wishlistTotalUsd: 1500 });
    expect(status.remainingUsd).toBe(-500);
    expect(status.overBudget).toBe(true);
    expect(status.coveragePct).toBe(150);
  });

  it('returns null coverage when there is no budget', () => {
    const status = budgetStatus({ monthlyBudgetUsd: 0, wishlistTotalUsd: 999 });
    expect(status.coveragePct).toBeNull();
    expect(status.overBudget).toBe(false);
  });
});
