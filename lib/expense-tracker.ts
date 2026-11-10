/**
 * AI Receipt & Expense Tracker — Section 7, item 2.
 *
 * Pure, deterministic helpers over the user's own recorded expenses
 * (migration contract: `user_expenses`). The amount of an expense is
 * ALWAYS user-entered or a recorded price — never auto-derived from
 * thin air. File bytes are NEVER uploaded: there is no receipt image
 * upload anywhere in this feature (Receipt Vault rule).
 *
 * Categories are a fixed list; anything outside it is rejected at
 * the API layer and never silently re-categorised here.
 */

export const EXPENSE_CATEGORIES = [
  'Tech',
  'Home',
  'Fashion',
  'Groceries',
  'Entertainment',
  'Other',
] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export type ExpenseSource = 'manual' | 'confirmed_purchase';

export interface Expense {
  id: string;
  userId: string;
  amountUsd: number;
  category: ExpenseCategory;
  productSlug: string | null;
  note: string | null;
  /** ISO date (YYYY-MM-DD) the money was spent. */
  spentOn: string;
  source: ExpenseSource;
  createdAt: string;
}

export function isExpenseCategory(value: unknown): value is ExpenseCategory {
  return typeof value === 'string' && (EXPENSE_CATEGORIES as readonly string[]).includes(value);
}

export function roundToCents(value: number): number {
  return Math.round(value * 100) / 100;
}

/** `YYYY-MM` key for a spent_on date, or null for an unparseable date. */
export function monthKeyForDate(date: string): string | null {
  const match = /^(\d{4})-(\d{2})-\d{2}$/.exec(date);
  if (!match) return null;
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  return `${match[1]}-${match[2]}`;
}

export function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

export function expensesForMonth(expenses: Expense[], year: number, month: number): Expense[] {
  const key = monthKey(year, month);
  return expenses.filter((expense) => monthKeyForDate(expense.spentOn) === key);
}

export interface MonthlyCategoryTotals {
  byCategory: Record<ExpenseCategory, number>;
  totalUsd: number;
  expenseCount: number;
}

function emptyTotals(): Record<ExpenseCategory, number> {
  return {
    Tech: 0,
    Home: 0,
    Fashion: 0,
    Groceries: 0,
    Entertainment: 0,
    Other: 0,
  };
}

/**
 * Monthly totals by category. Only expenses with a valid category and
 * a finite positive amount count — anything else is ignored, never
 * guessed into a bucket.
 */
export function monthlyTotalsByCategory(
  expenses: Expense[],
  year: number,
  month: number
): MonthlyCategoryTotals {
  const byCategory = emptyTotals();
  let totalUsd = 0;
  let expenseCount = 0;
  for (const expense of expensesForMonth(expenses, year, month)) {
    if (!isExpenseCategory(expense.category)) continue;
    if (!Number.isFinite(expense.amountUsd) || expense.amountUsd <= 0) continue;
    byCategory[expense.category] = roundToCents(byCategory[expense.category] + expense.amountUsd);
    totalUsd = roundToCents(totalUsd + expense.amountUsd);
    expenseCount += 1;
  }
  return { byCategory, totalUsd, expenseCount };
}

export interface BudgetComparison {
  category: ExpenseCategory;
  spentUsd: number;
  budgetUsd: number | null;
  /** Amount over budget, or null when within budget / no budget set. */
  overByUsd: number | null;
  overBudget: boolean;
}

/**
 * Compare a month's spend against per-category budgets. A category
 * with no budget set is never flagged — there is nothing to compare
 * against, so `overBudget` stays false and `budgetUsd` is null.
 */
export function compareToBudget(
  totals: MonthlyCategoryTotals,
  budgets: Partial<Record<ExpenseCategory, number>>
): BudgetComparison[] {
  return EXPENSE_CATEGORIES.map((category) => {
    const budget = budgets[category];
    const budgetUsd =
      typeof budget === 'number' && Number.isFinite(budget) && budget > 0
        ? roundToCents(budget)
        : null;
    const spentUsd = totals.byCategory[category];
    const overByUsd = budgetUsd !== null && spentUsd > budgetUsd ? roundToCents(spentUsd - budgetUsd) : null;
    return { category, spentUsd, budgetUsd, overByUsd, overBudget: overByUsd !== null };
  });
}

export interface MonthTrendPoint {
  /** `YYYY-MM` */
  month: string;
  totalUsd: number;
  expenseCount: number;
}

/**
 * Spend trend for the last `months` calendar months ending at
 * (year, month), oldest first. Months with no expenses report $0 —
 * never an interpolated or estimated figure.
 */
export function spendTrend(
  expenses: Expense[],
  year: number,
  month: number,
  months = 6
): MonthTrendPoint[] {
  const count = Math.max(1, Math.min(24, Math.floor(months)));
  const points: MonthTrendPoint[] = [];
  let y = year;
  let m = month;
  for (let i = 0; i < count; i++) {
    const totals = monthlyTotalsByCategory(expenses, y, m);
    points.unshift({ month: monthKey(y, m), totalUsd: totals.totalUsd, expenseCount: totals.expenseCount });
    m -= 1;
    if (m === 0) {
      m = 12;
      y -= 1;
    }
  }
  return points;
}
