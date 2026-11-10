import { describe, expect, it } from 'vitest';
import {
  compareToBudget,
  EXPENSE_CATEGORIES,
  expensesForMonth,
  isExpenseCategory,
  monthlyTotalsByCategory,
  monthKeyForDate,
  spendTrend,
  type Expense,
} from '@/lib/expense-tracker';

function expense(overrides: Partial<Expense> = {}): Expense {
  return {
    id: 'exp-1',
    userId: 'user-1',
    amountUsd: 100,
    category: 'Tech',
    productSlug: null,
    note: null,
    spentOn: '2026-11-05',
    source: 'manual',
    createdAt: '2026-11-05T00:00:00Z',
    ...overrides,
  };
}

describe('isExpenseCategory', () => {
  it('accepts only the fixed category list', () => {
    for (const category of EXPENSE_CATEGORIES) {
      expect(isExpenseCategory(category)).toBe(true);
    }
    expect(isExpenseCategory('Travel')).toBe(false);
    expect(isExpenseCategory('tech')).toBe(false);
    expect(isExpenseCategory(null)).toBe(false);
    expect(isExpenseCategory(42)).toBe(false);
  });
});

describe('monthKeyForDate', () => {
  it('extracts YYYY-MM from a valid date', () => {
    expect(monthKeyForDate('2026-11-05')).toBe('2026-11');
    expect(monthKeyForDate('2026-01-31')).toBe('2026-01');
  });

  it('returns null for invalid dates', () => {
    expect(monthKeyForDate('2026-13-01')).toBeNull();
    expect(monthKeyForDate('not-a-date')).toBeNull();
    expect(monthKeyForDate('')).toBeNull();
  });
});

describe('expensesForMonth', () => {
  it('keeps only expenses from the requested month', () => {
    const rows = [
      expense({ id: 'a', spentOn: '2026-11-01' }),
      expense({ id: 'b', spentOn: '2026-10-31' }),
      expense({ id: 'c', spentOn: '2026-12-01' }),
    ];
    expect(expensesForMonth(rows, 2026, 11).map((row) => row.id)).toEqual(['a']);
  });
});

describe('monthlyTotalsByCategory', () => {
  it('totals by category and overall for the month', () => {
    const rows = [
      expense({ id: 'a', amountUsd: 299.99, category: 'Tech' }),
      expense({ id: 'b', amountUsd: 50, category: 'Tech' }),
      expense({ id: 'c', amountUsd: 120.5, category: 'Groceries' }),
      expense({ id: 'd', amountUsd: 999, category: 'Tech', spentOn: '2026-10-15' }),
    ];
    const totals = monthlyTotalsByCategory(rows, 2026, 11);
    expect(totals.byCategory.Tech).toBe(349.99);
    expect(totals.byCategory.Groceries).toBe(120.5);
    expect(totals.byCategory.Home).toBe(0);
    expect(totals.totalUsd).toBe(470.49);
    expect(totals.expenseCount).toBe(3);
  });

  it('returns zeros for a month with no expenses — never a guessed figure', () => {
    const totals = monthlyTotalsByCategory([], 2026, 11);
    expect(totals.totalUsd).toBe(0);
    expect(totals.expenseCount).toBe(0);
    for (const category of EXPENSE_CATEGORIES) {
      expect(totals.byCategory[category]).toBe(0);
    }
  });

  it('ignores non-positive or non-finite amounts', () => {
    const rows = [
      expense({ id: 'a', amountUsd: 100 }),
      expense({ id: 'b', amountUsd: 0 }),
      expense({ id: 'c', amountUsd: -25 }),
      expense({ id: 'd', amountUsd: Number.NaN }),
    ];
    const totals = monthlyTotalsByCategory(rows, 2026, 11);
    expect(totals.totalUsd).toBe(100);
    expect(totals.expenseCount).toBe(1);
  });
});

describe('compareToBudget', () => {
  it('flags only categories over their budget', () => {
    const totals = monthlyTotalsByCategory(
      [
        expense({ amountUsd: 350, category: 'Tech' }),
        expense({ amountUsd: 80, category: 'Groceries' }),
      ],
      2026,
      11
    );
    const result = compareToBudget(totals, { Tech: 300, Groceries: 100 });
    const tech = result.find((row) => row.category === 'Tech');
    const groceries = result.find((row) => row.category === 'Groceries');
    const home = result.find((row) => row.category === 'Home');
    expect(tech?.overBudget).toBe(true);
    expect(tech?.overByUsd).toBe(50);
    expect(groceries?.overBudget).toBe(false);
    expect(groceries?.overByUsd).toBeNull();
    // No budget set → never flagged.
    expect(home?.budgetUsd).toBeNull();
    expect(home?.overBudget).toBe(false);
  });

  it('ignores invalid budget values instead of inventing a comparison', () => {
    const totals = monthlyTotalsByCategory([expense({ amountUsd: 10 })], 2026, 11);
    const result = compareToBudget(totals, { Tech: 0, Home: -5, Fashion: Number.NaN });
    for (const row of result.filter((r) => ['Tech', 'Home', 'Fashion'].includes(r.category))) {
      expect(row.budgetUsd).toBeNull();
      expect(row.overBudget).toBe(false);
    }
  });
});

describe('spendTrend', () => {
  it('returns the last N months oldest-first, with $0 for empty months', () => {
    const rows = [
      expense({ id: 'a', amountUsd: 100, spentOn: '2026-11-05' }),
      expense({ id: 'b', amountUsd: 200, spentOn: '2026-09-10' }),
    ];
    const trend = spendTrend(rows, 2026, 11, 3);
    expect(trend).toEqual([
      { month: '2026-09', totalUsd: 200, expenseCount: 1 },
      { month: '2026-10', totalUsd: 0, expenseCount: 0 },
      { month: '2026-11', totalUsd: 100, expenseCount: 1 },
    ]);
  });
});
