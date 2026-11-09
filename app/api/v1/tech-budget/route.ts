/**
 * API v1 tech budget endpoint (Option 16).
 * GET /api/v1/tech-budget — the signed-in user's tech budget row.
 * POST /api/v1/tech-budget — upsert the caller's own budget row.
 *
 * Auth required, owner-scoped via RLS + the user_id upsert key.
 * Fail-safe: when migration 019 has not been run yet the table is
 * missing — GET returns the defaults (saved: false) and POST returns
 * 503 with an honest message instead of breaking the caller.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess, badRequest, internalError } from '@/lib/api/responses';
import { logApiRequest, requireAuth } from '@/lib/api/middleware';
import {
  getTechBudget,
  upsertTechBudget,
  DEFAULT_MONTHLY_TECH_BUDGET_USD,
  DEFAULT_DAILY_TARGET_HOURS,
} from '@/services/tech-budget';

export async function GET(request: NextRequest) {
  logApiRequest(request, { endpoint: 'tech-budget.get' });

  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  try {
    const supabase = await createSupabaseServerClient();
    const budget = await getTechBudget(supabase, auth.userId);
    if (!budget) {
      return apiSuccess({
        monthlyTechBudgetUsd: DEFAULT_MONTHLY_TECH_BUDGET_USD,
        dailyTargetHours: DEFAULT_DAILY_TARGET_HOURS,
        saved: false,
      });
    }
    return apiSuccess(budget);
  } catch {
    return internalError('Failed to load tech budget');
  }
}

export async function POST(request: NextRequest) {
  logApiRequest(request, { endpoint: 'tech-budget.save' });

  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  try {
    const body = await request.json().catch(() => null);
    const monthlyTechBudgetUsd = Number(body?.monthlyTechBudgetUsd);
    const dailyTargetHours = Number(body?.dailyTargetHours);
    if (
      !Number.isFinite(monthlyTechBudgetUsd) ||
      monthlyTechBudgetUsd <= 0 ||
      !Number.isFinite(dailyTargetHours) ||
      dailyTargetHours <= 0
    ) {
      return badRequest('monthlyTechBudgetUsd and dailyTargetHours must be numbers above 0');
    }

    const supabase = await createSupabaseServerClient();
    const saved = await upsertTechBudget(supabase, auth.userId, {
      monthlyTechBudgetUsd,
      dailyTargetHours,
    });
    if (!saved) {
      // Table missing (migration 019 not run) or write failed — 503
      // with the honest reason, so the UI can offer device-only save.
      return apiSuccess(
        { error: 'Tech budget table is not set up yet — run migration 019 in Supabase.' },
        503
      );
    }
    return apiSuccess(saved);
  } catch {
    return internalError('Failed to save tech budget');
  }
}
