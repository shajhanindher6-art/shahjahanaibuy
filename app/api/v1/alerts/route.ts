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
import { logApiRequest, requireAuth, rateLimitResponse, getClientIp } from '@/lib/api/middleware';
import {
  checkAlertCap,
  countAlerts,
  getAlerts,
  createAlert,
  type CreateAlertInput,
} from '@/services/alerts';
import { BILLING_URL, getTierForUserId, getUpgradeTier } from '@/lib/api-quota';
import { getMaxAlerts, getTier } from '@/lib/tiers';
import { getCachedProductBySlug } from '@/services/products';

export async function GET(request: NextRequest) {
  logApiRequest(request, { endpoint: 'alerts' });
  // Rate limit: 120 requests/min per IP (see docs/rate-limits.md).
  const limited = await rateLimitResponse(`alerts:${getClientIp(request)}`, 120);
  if (limited) return limited;

  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  try {
    const supabase = await createSupabaseServerClient();
    const alerts = await getAlerts(supabase, auth.userId);
    // The guest-merge runner reads this meta to cap the merge at
    // the signed-in tier's limit without a separate tier lookup.
    const tier = await getTierForUserId(auth.userId);
    const count = await countAlerts(supabase, auth.userId);
    return apiSuccess(alerts, 200, {
      maxAlerts: getMaxAlerts(tier),
      alertCount: count < 0 ? alerts.length : count,
    });
  } catch {
    return internalError('Failed to fetch alerts');
  }
}

export async function POST(request: NextRequest) {
  logApiRequest(request, { endpoint: 'alerts.create' });
  // Rate limit: 30 requests/min per IP (see docs/rate-limits.md).
  const limited = await rateLimitResponse(`alerts:${getClientIp(request)}`, 30);
  if (limited) return limited;

  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  try {
    const body = await request.json();
    const { productSlug, productId, alertType, conditionValue, channel } = body ?? {};

    const validTypes = ['price_drop', 'back_in_stock', 'deal'];
    if (!validTypes.includes(alertType)) {
      return badRequest('alertType must be one of: price_drop, back_in_stock, deal');
    }

    // Accept either a product slug or a product ID.
    const supabase = await createSupabaseServerClient();
    let resolvedProductId: string | undefined =
      typeof productId === 'string' ? productId : undefined;

    if (!resolvedProductId && typeof productSlug === 'string') {
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

    const input: CreateAlertInput = {
      productId: resolvedProductId,
      alertType,
      conditionValue: typeof conditionValue === 'number' ? conditionValue : undefined,
      channel: channel === 'email' || channel === 'push' || channel === 'both' ? channel : undefined,
    };

    const alert = await createAlert(supabase, auth.userId, input);

    if (!alert) {
      return internalError('Failed to create alert');
    }

    return apiSuccess(alert, 201);
  } catch {
    return internalError('Failed to create alert');
  }
}
