/**
 * API v1 expense tracker — Section 7, item 2.
 * GET  /api/v1/tools/expenses — the signed-in user's expenses plus
 *        monthly totals by category and a 6-month spend trend.
 * POST /api/v1/tools/expenses — add an expense. The amount is
 *        user-entered OR a recorded price — never auto-derived.
 *        No receipt image upload exists anywhere in this feature:
 *        file bytes are never uploaded (Receipt Vault rule).
 *
 * Fail-safe: until the migration is run, GET returns
 * { expenses: [], ..., expensesEnabled: false } and POST returns 503.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  apiSuccess,
  internalError,
  serviceUnavailable,
  validationError,
} from '@/lib/api/responses';
import { logApiRequest, rateLimitResponse, requireAuth } from '@/lib/api/middleware';
import { isMissingTableError } from '@/lib/agent-hunt';
import {
  EXPENSE_CATEGORIES,
  isExpenseCategory,
  monthlyTotalsByCategory,
  roundToCents,
  spendTrend,
  type Expense,
  type ExpenseCategory,
  type ExpenseSource,
} from '@/lib/expense-tracker';

import { logApiError } from '@/lib/api/error-logging';
export const dynamic = 'force-dynamic';

const EXPENSE_COLUMNS =
  'id, user_id, amount_usd, category, product_slug, note, spent_on, source, created_at';

function isMissingTableOrColumn(error: unknown): boolean {
  if (isMissingTableError(error)) return true;
  const code = (error as { code?: unknown } | null)?.code;
  return code === '42703';
}

function mapExpenseRow(row: Record<string, unknown>): Expense | null {
  const amount =
    typeof row.amount_usd === 'number'
      ? row.amount_usd
      : parseFloat(String(row.amount_usd));
  if (!Number.isFinite(amount) || amount <= 0) return null;
  if (!isExpenseCategory(row.category)) return null;
  const spentOn = typeof row.spent_on === 'string' ? row.spent_on : null;
  if (!spentOn || !/^\d{4}-\d{2}-\d{2}$/.test(spentOn)) return null;
  return {
    id: String(row.id),
    userId: String(row.user_id),
    amountUsd: roundToCents(amount),
    category: row.category as ExpenseCategory,
    productSlug: typeof row.product_slug === 'string' ? row.product_slug : null,
    note: typeof row.note === 'string' ? row.note : null,
    spentOn,
    source: row.source === 'confirmed_purchase' ? 'confirmed_purchase' : 'manual',
    createdAt: String(row.created_at),
  };
}

function parseMonthParam(request: NextRequest): { year: number; month: number } {
  const now = new Date();
  const yearParam = Number(request.nextUrl.searchParams.get('year'));
  const monthParam = Number(request.nextUrl.searchParams.get('month'));
  const year = Number.isInteger(yearParam) && yearParam >= 2000 && yearParam <= 2100
    ? yearParam
    : now.getUTCFullYear();
  const month = Number.isInteger(monthParam) && monthParam >= 1 && monthParam <= 12
    ? monthParam
    : now.getUTCMonth() + 1;
  return { year, month };
}

export async function GET(request: NextRequest) {
  logApiRequest(request, { endpoint: 'tools.expenses' });

  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  const limited = await rateLimitResponse(`tools-expenses:${auth.userId}`, 30);
  if (limited) return limited;

  const { year, month } = parseMonthParam(request);

  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from('user_expenses')
      .select(EXPENSE_COLUMNS)
      .eq('user_id', auth.userId)
      .order('spent_on', { ascending: false })
      .limit(500);
    if (error) {
      if (isMissingTableOrColumn(error)) {
        return apiSuccess({
          expenses: [],
          totals: monthlyTotalsByCategory([], year, month),
          trend: spendTrend([], year, month),
          year,
          month,
          expensesEnabled: false,
        });
      }
      return internalError('Failed to fetch expenses');
    }
    const expenses = ((data ?? []) as Array<Record<string, unknown>>)
      .map(mapExpenseRow)
      .filter((row): row is Expense => row !== null);
    return apiSuccess({
      expenses,
      totals: monthlyTotalsByCategory(expenses, year, month),
      trend: spendTrend(expenses, year, month),
      year,
      month,
      expensesEnabled: true,
    });
  } catch (err) {
    logApiError(err, { request, route: 'tools.expenses.get', status: 500 });
    return internalError('Failed to fetch expenses');
  }
}

export async function POST(request: NextRequest) {
  logApiRequest(request, { endpoint: 'tools.expenses.create' });

  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  const limited = await rateLimitResponse(`tools-expenses:${auth.userId}`, 30);
  if (limited) return limited;

  try {
    const body = await request.json().catch(() => null);
    const amountUsd = body?.amount_usd;
    const category = body?.category;
    const spentOn = typeof body?.spent_on === 'string' ? body.spent_on.trim() : '';
    const source: ExpenseSource =
      body?.source === 'confirmed_purchase' ? 'confirmed_purchase' : 'manual';
    const productSlug =
      typeof body?.product_slug === 'string' && body.product_slug.trim() !== ''
        ? body.product_slug.trim()
        : null;
    const note =
      typeof body?.note === 'string' && body.note.trim() !== '' ? body.note.trim() : null;

    if (typeof amountUsd !== 'number' || !Number.isFinite(amountUsd) || amountUsd <= 0) {
      return validationError('amount_usd must be a number greater than 0.');
    }
    if (!isExpenseCategory(category)) {
      return validationError(
        `category must be one of: ${EXPENSE_CATEGORIES.join(', ')}.`
      );
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(spentOn) || Number.isNaN(Date.parse(spentOn))) {
      return validationError('spent_on must be a valid date (YYYY-MM-DD).');
    }

    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from('user_expenses')
      .insert({
        user_id: auth.userId,
        amount_usd: roundToCents(amountUsd),
        category,
        product_slug: productSlug,
        note,
        spent_on: spentOn,
        source,
      })
      .select(EXPENSE_COLUMNS)
      .single();
    if (error) {
      if (isMissingTableOrColumn(error)) {
        return serviceUnavailable(
          'Expense tracking is not set up yet — the owner still needs to run the migration once.'
        );
      }
      return internalError('Failed to record expense');
    }
    const expense = mapExpenseRow(data as Record<string, unknown>);
    if (!expense) return internalError('Failed to record expense');
    return apiSuccess({ expense, expensesEnabled: true }, 201);
  } catch (err) {
    logApiError(err, { request, route: 'tools.expenses.post', status: 500 });
    return internalError('Failed to record expense');
  }
}
