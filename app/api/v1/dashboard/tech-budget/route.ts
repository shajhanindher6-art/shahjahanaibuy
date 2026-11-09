/**
 * API v1 dashboard tech-budget endpoint (Option 16).
 * GET /api/v1/dashboard/tech-budget — the signed-in user's tech
 * budget plus the total ownership cost of their wishlist items
 * (lowest recorded merchant price per product; unpriced items count
 * $0 and are flagged, never guessed).
 *
 * Auth required and owner-scoped. Fail-safe: a missing migration 019
 * table yields defaults and zeros, never an error page.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess, internalError } from '@/lib/api/responses';
import { logApiRequest, requireAuth } from '@/lib/api/middleware';
import {
  getTechBudget,
  getWishlistOwnershipTotal,
  DEFAULT_MONTHLY_TECH_BUDGET_USD,
  DEFAULT_DAILY_TARGET_HOURS,
} from '@/services/tech-budget';

export async function GET(request: NextRequest) {
  logApiRequest(request, { endpoint: 'dashboard.tech-budget' });

  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  try {
    const supabase = await createSupabaseServerClient();
    const [budget, wishlist] = await Promise.all([
      getTechBudget(supabase, auth.userId),
      getWishlistOwnershipTotal(supabase, auth.userId),
    ]);
    return apiSuccess({
      budget: budget ?? {
        monthlyTechBudgetUsd: DEFAULT_MONTHLY_TECH_BUDGET_USD,
        dailyTargetHours: DEFAULT_DAILY_TARGET_HOURS,
        saved: false,
      },
      wishlist,
    });
  } catch {
    return internalError('Failed to load tech budget');
  }
}
