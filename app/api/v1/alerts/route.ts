/**
 * API v1 alerts endpoint.
 * GET  /api/v1/alerts — list the authenticated user's alerts.
 * POST /api/v1/alerts — create an alert (auth required).
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  apiError,
  apiSuccess,
  badRequest,
  internalError,
} from '@/lib/api/responses';
import {
  logApiRequest,
  requireAuth,
  rateLimitResponse,
  getClientIp,
} from '@/lib/api/middleware';
import { checkCsrfOrigin } from '@/lib/api/csrf';
import { validateBody } from '@/lib/api/validation';
import { z } from 'zod';
import {
  checkAlertCap,
  countAlerts,
  getAlerts,
  createAlert,
  type CreateAlertInput,
} from '@/services/alerts';
import { SIGNIFICANT_DROP_THRESHOLD_PCT } from '@/services/alert-triggers';

/**
 * Section 18, Phase 2, item 10 (audit §1 #13) — create-alert body
 * validated with the shared `validateBody` helper (Zod), matching
 * the subscriptions route. `alertType`/`channel` are enums (a bad
 * value is now a 400, as before); `conditionValue` must be a real
 * number when present (a string used to be silently dropped);
 * `productSlug`/`productId` must be non-empty strings when
 * present. The "productId or productSlug is required" 400 below
 * is unchanged.
 */
const createAlertSchema = z.object({
  productSlug: z.string().min(1).optional(),
  productId: z.string().min(1).optional(),
  // Section 19, Phase 6 (§12 #61/#62/#64): significant_drop,
  // trend, opportunity. conditionValue is the drop-% threshold
  // for significant_drop (default 10 when omitted — applied
  // below); unused for trend / opportunity.
  alertType: z.enum(['price_drop', 'back_in_stock', 'deal', 'significant_drop', 'trend', 'opportunity']),
  conditionValue: z.number().optional(),
  channel: z.enum(['email', 'push', 'both']).optional(),
});
import { BILLING_URL, getTierForUserId, getUpgradeTier } from '@/lib/api-quota';
import { getMaxAlerts, getTier } from '@/lib/tiers';
import { getCachedProductBySlug } from '@/services/products';

import { logApiError } from '@/lib/api/error-logging';
export async function GET(request: NextRequest) {
  logApiRequest(request, { endpoint: 'alerts' });
  // Rate limit: 120 requests/min per IP (see docs/rate-limits.md).
  const limited = await rateLimitResponse(`alerts:${getClientIp(request)}`, 120);
  if (limited) return limited;

  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  try {
    const supabase = await createSupabaseServerClient();
    // Section 21–25, Stage J, J-P2-5 — the list is capped in
    // getAlerts (default 100, max 500); ?limit= lets the page ask
    // for fewer, never more than the cap.
    const limitParam = Number(request.nextUrl.searchParams.get('limit') ?? '');
    const alerts = await getAlerts(
      supabase,
      auth.userId,
      Number.isFinite(limitParam) && limitParam > 0 ? limitParam : undefined
    );
    // The guest-merge runner reads this meta to cap the merge at
    // the signed-in tier's limit without a separate tier lookup.
    const tier = await getTierForUserId(auth.userId);
    const count = await countAlerts(supabase, auth.userId);
    return apiSuccess(alerts, 200, {
      maxAlerts: getMaxAlerts(tier),
      alertCount: count < 0 ? alerts.length : count,
    });
  } catch (err) {
    logApiError(err, { request, route: 'alerts.get', status: 500 });
    return internalError('Failed to fetch alerts');
  }
}

export async function POST(request: NextRequest) {
  logApiRequest(request, { endpoint: 'alerts.create' });
  // Rate limit: 30 requests/min per IP (see docs/rate-limits.md).
  const limited = await rateLimitResponse(`alerts:${getClientIp(request)}`, 30);
  if (limited) return limited;

  // Section 18, Phase 2, item 8 — CSRF Origin check (cookie-authed
  // mutation; absent Origin fails open for non-browser clients).
  const csrf = checkCsrfOrigin(request);
  if (csrf) return csrf;

  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  try {
    const body = await request.json().catch(() => null);
    const validation = validateBody(createAlertSchema, body ?? {});
    if (!validation.success) {
      const firstError = Object.values(validation.errors).flat()[0];
      return badRequest(firstError ?? 'Invalid request body');
    }
    const { productSlug, productId, alertType, conditionValue, channel } = validation.data;

    // Accept either a product slug or a product ID.
    const supabase = await createSupabaseServerClient();
    let resolvedProductId: string | undefined = productId;

    if (!resolvedProductId && productSlug) {
      const product = await getCachedProductBySlug(supabase, productSlug);
      resolvedProductId = product?.id;
    }

    if (!resolvedProductId) {
      return badRequest('productId or productSlug is required');
    }

    // Section 15 B14: enforce the signed-in tier's alert cap
    // (Free = 5) before inserting — a 6th alert is a 403 with an
    // upgrade hint, never a silent drop or a 500.
    const tier = await getTierForUserId(auth.userId);
    const cap = await checkAlertCap(supabase, auth.userId, tier);
    if (!cap.allowed && cap.max !== null) {
      const tierName = getTier(tier)?.name ?? tier;
      const upgradeTier = getUpgradeTier(tier);
      const upgrade = upgradeTier ? getTier(upgradeTier) : null;
      return apiError(
        'FORBIDDEN',
        `Your ${tierName} plan allows up to ${cap.max} price alerts (you have ${cap.current}). ` +
          (upgrade
            ? `Upgrade to ${upgrade.name} for unlimited price alerts. `
            : `You are on the highest alert tier. `) +
          `See ${BILLING_URL}.`,
        403,
        {
          tier,
          limit: cap.max,
          current: cap.current,
          upgradeTier: upgradeTier ?? null,
          billingUrl: BILLING_URL,
        }
      );
    }

    // Section 18, Phase 2, item 10: conditionValue/channel are
    // already validated by createAlertSchema above — no re-check.
    // Section 19, Phase 6 (§12 #61): a significant_drop alert
    // without an explicit threshold means "10% or more".
    const input: CreateAlertInput = {
      productId: resolvedProductId,
      alertType,
      conditionValue:
        alertType === 'significant_drop' && conditionValue === undefined
          ? SIGNIFICANT_DROP_THRESHOLD_PCT
          : conditionValue,
      channel,
    };

    const alert = await createAlert(supabase, auth.userId, input);

    if (!alert) {
      return internalError('Failed to create alert');
    }

    return apiSuccess(alert, 201);
  } catch (err) {
    logApiError(err, { request, route: 'alerts.post', status: 500 });
    return internalError('Failed to create alert');
  }
}
