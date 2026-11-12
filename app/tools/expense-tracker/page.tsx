/**
 * AI Receipt & Expense Tracker — Section 7, item 2.
 *
 * Client page: add an expense (amount is user-entered or a recorded
 * price — never auto-derived), monthly totals by category, a
 * 6-month spend trend, and an optional per-category budget
 * comparison. Budgets are the user's own numbers, kept only in this
 * browser (localStorage) — they are never sent anywhere. No receipt
 * image upload exists: file bytes are never uploaded (Vault rule).
 *
 * A failed fetch shows an honest empty state, never invented totals.
 */

'use client';

import { useRegion } from '@/components/region/region-provider';
import { tFor } from '@/lib/i18n';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { SiteHeader } from '@/components/layout/site-header';
import { SiteFooter } from '@/components/layout/site-footer';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { EmptyState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  EXPENSE_CATEGORIES,
  compareToBudget,
  type Expense,
  type ExpenseCategory,
  type MonthlyCategoryTotals,
  type MonthTrendPoint,
} from '@/lib/expense-tracker';

interface ExpensesResponse {
  expenses: Expense[];
  totals: MonthlyCategoryTotals;
  trend: MonthTrendPoint[];
  year: number;
  month: number;
  expensesEnabled: boolean;
}

const BUDGET_STORAGE_KEY = 'sb-expense-budgets';

function currentMonthValue(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function loadBudgets(): Partial<Record<ExpenseCategory, number>> {
  try {
    const raw = window.localStorage.getItem(BUDGET_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const budgets: Partial<Record<ExpenseCategory, number>> = {};
    for (const category of EXPENSE_CATEGORIES) {
      const value = parsed[category];
      if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        budgets[category] = value;
      }
    }
    return budgets;
  } catch {
    return {};
  }
}

export default function ExpensesPage() {
  const { language } = useRegion();
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [totals, setTotals] = useState<MonthlyCategoryTotals | null>(null);
  const [trend, setTrend] = useState<MonthTrendPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [unauthorized, setUnauthorized] = useState(false);
  const [expensesEnabled, setExpensesEnabled] = useState(true);
  const [monthValue, setMonthValue] = useState(currentMonthValue());
  const [budgets, setBudgets] = useState<Partial<Record<ExpenseCategory, number>>>({});

  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState<ExpenseCategory>('Tech');
  const [spentOn, setSpentOn] = useState(() => new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState('');
  const [source, setSource] = useState<'manual' | 'confirmed_purchase'>('manual');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formOk, setFormOk] = useState(false);

  const load = useCallback(async (month: string) => {
    setLoading(true);
    setFailed(false);
    try {
      const [year, monthNum] = month.split('-');
      const params = new URLSearchParams({ year, month: monthNum });
      const res = await fetch(`/api/v1/tools/expenses?${params.toString()}`);
      const json = await res.json().catch(() => null);
      if (res.status === 401) {
        setUnauthorized(true);
        return;
      }
      setUnauthorized(false);
      if (res.ok && json?.success && json.data) {
        const data = json.data as ExpensesResponse;
        setExpenses(data.expenses);
        setTotals(data.totals);
        setTrend(data.trend);
        setExpensesEnabled(data.expensesEnabled !== false);
      } else {
        setFailed(true);
      }
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setBudgets(loadBudgets());
    load(monthValue);
  }, [load, monthValue]);

  function setBudget(category: ExpenseCategory, raw: string) {
    const value = parseFloat(raw);
    const next = { ...budgets };
    if (Number.isFinite(value) && value > 0) {
      next[category] = value;
    } else {
      delete next[category];
    }
    setBudgets(next);
    try {
      window.localStorage.setItem(BUDGET_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Budgets are a convenience only — a storage failure loses nothing.
    }
  }

  async function submitExpense(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setFormOk(false);
    const amountUsd = parseFloat(amount);
    if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
      setFormError('Enter an amount greater than 0.');
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(spentOn)) {
      setFormError('Enter a valid date.');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/v1/tools/expenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount_usd: amountUsd,
          category,
          spent_on: spentOn,
          note: note.trim() === '' ? null : note.trim(),
          source,
        }),
      });
      const json = await res.json().catch(() => null);
      if (res.ok && json?.success) {
        setAmount('');
        setNote('');
        setFormOk(true);
        await load(monthValue);
      } else if (res.status === 401) {
        setFormError('Sign in to record an expense.');
      } else {
        setFormError(json?.error?.message ?? 'Could not record the expense. Try again.');
      }
    } catch {
      setFormError('Could not record the expense. Try again.');
    } finally {
      setSaving(false);
    }
  }

  const budgetRows = totals ? compareToBudget(totals, budgets) : [];

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
        <h1 className="text-2xl font-bold">{tFor(language, 'toolHeadingExpenseTracker')}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Monthly spend by category, from expenses you record yourself.
          The amount is always entered by you or taken from a recorded
          price — never guessed. No receipt photos are uploaded: nothing
          leaves your device except the numbers you type. Totals, trends
          and budget flags are computed with deterministic rules from
          your recorded expenses — no LLM, nothing guessed.
        </p>

        {!expensesEnabled && (
          <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
            Expense tracking is not live yet — the owner still needs to run
            the migration once. Until then, no expenses can be recorded.
          </p>
        )}

        <form
          className="mt-6 flex flex-wrap items-end gap-3 rounded-lg border p-4"
          onSubmit={submitExpense}
        >
          <div className="space-y-2">
            <Label htmlFor="expAmount">Amount (USD)</Label>
            <Input
              id="expAmount"
              type="number"
              min="0.01"
              step="0.01"
              inputMode="decimal"
              placeholder="e.g. 299.99"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="expCategory">Category</Label>
            <select
              id="expCategory"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={category}
              onChange={(e) => setCategory(e.target.value as ExpenseCategory)}
            >
              {EXPENSE_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="expDate">Date spent</Label>
            <Input
              id="expDate"
              type="date"
              value={spentOn}
              onChange={(e) => setSpentOn(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="expSource">Amount source</Label>
            <select
              id="expSource"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={source}
              onChange={(e) => setSource(e.target.value as 'manual' | 'confirmed_purchase')}
            >
              <option value="manual">Entered by me</option>
              <option value="confirmed_purchase">Recorded purchase price</option>
            </select>
          </div>
          <div className="min-w-48 flex-1 space-y-2">
            <Label htmlFor="expNote">Note (optional)</Label>
            <Input
              id="expNote"
              placeholder="e.g. Laptop charger"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          <Button type="submit" disabled={saving || !expensesEnabled}>
            {saving ? 'Saving…' : 'Add expense'}
          </Button>
        </form>
        {formError && <p className="mt-2 text-sm text-red-600">{formError}</p>}
        {formOk && <p className="mt-2 text-sm text-green-700">Expense recorded.</p>}

        <div className="mt-8 flex flex-wrap items-end gap-3">
          <div className="space-y-2">
            <Label htmlFor="expMonth">Month</Label>
            <Input
              id="expMonth"
              type="month"
              value={monthValue}
              onChange={(e) => {
                if (e.target.value) setMonthValue(e.target.value);
              }}
            />
          </div>
        </div>

        <div className="mt-6">
          {loading ? (
            <LoadingSpinner />
          ) : unauthorized ? (
            <div>
              <EmptyState
                title="Sign in to see your expenses"
                description="Your expenses are private to your account."
              />
              <p className="mt-4 text-sm">
                <Link href="/sign-in" className="underline">
                  Sign in
                </Link>
              </p>
            </div>
          ) : failed ? (
            <EmptyState
              title="Expenses could not be loaded"
              description="Try again later. No totals are shown rather than guessed ones."
            />
          ) : !totals ? (
            <EmptyState
              title="No expenses yet"
              description="Add your first expense above — monthly totals appear here once you have recorded spending."
            />
          ) : (
            <>
              <h2 className="text-lg font-semibold">
                {monthValue} — total ${totals.totalUsd.toFixed(2)} ({totals.expenseCount}{' '}
                {totals.expenseCount === 1 ? 'expense' : 'expenses'})
              </h2>
              <table className="mt-3 w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b text-left">
                    <th className="py-2 pr-2">Category</th>
                    <th className="py-2 pr-2">Spent</th>
                    <th className="py-2 pr-2">Monthly budget (optional)</th>
                    <th className="py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {budgetRows.map((row) => (
                    <tr key={row.category} className="border-b">
                      <td className="py-2 pr-2 font-medium">{row.category}</td>
                      <td className="py-2 pr-2">${row.spentUsd.toFixed(2)}</td>
                      <td className="py-2 pr-2">
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          inputMode="decimal"
                          aria-label={`${row.category} monthly budget`}
                          placeholder="No budget"
                          value={budgets[row.category] ?? ''}
                          onChange={(e) => setBudget(row.category, e.target.value)}
                        />
                      </td>
                      <td className="py-2">
                        {row.overBudget ? (
                          <span className="font-medium text-red-600">
                            Over budget by ${row.overByUsd?.toFixed(2)}
                          </span>
                        ) : row.budgetUsd !== null ? (
                          <span className="text-green-700">Within budget</span>
                        ) : (
                          <span className="text-muted-foreground">No budget set</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {trend.length > 0 && (
                <div className="mt-6">
                  <h3 className="text-base font-semibold">Spend trend (last 6 months)</h3>
                  <ul className="mt-2 space-y-1 text-sm">
                    {trend.map((point) => (
                      <li key={point.month} className="flex justify-between border-b py-1">
                        <span>{point.month}</span>
                        <span>
                          ${point.totalUsd.toFixed(2)} · {point.expenseCount}{' '}
                          {point.expenseCount === 1 ? 'expense' : 'expenses'}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {expenses.length === 0 ? (
                <p className="mt-6 text-sm text-muted-foreground">
                  No expenses recorded for this month yet.
                </p>
              ) : (
                <div className="mt-6">
                  <h3 className="text-base font-semibold">All recorded expenses</h3>
                  <ul className="mt-2 space-y-1 text-sm">
                    {expenses.map((expense) => (
                      <li key={expense.id} className="flex justify-between border-b py-1">
                        <span>
                          {expense.spentOn} · {expense.category}
                          {expense.note ? ` · ${expense.note}` : ''}
                          {expense.source === 'confirmed_purchase' ? ' · recorded price' : ''}
                        </span>
                        <span className="font-medium">${expense.amountUsd.toFixed(2)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
