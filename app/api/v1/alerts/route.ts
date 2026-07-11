/**
 * API v1 alerts endpoint.
 * GET  /api/v1/alerts — list the authenticated user's alerts.
 * POST /api/v1/alerts — create an alert (auth required).
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  apiSuccess,
  badRequest,
  internalError,
} from '@/lib/api/responses';
import { logApiRequest, requireAuth } from '@/lib/api/middleware';
import {
  getAlerts,
  createAlert,
  type CreateAlertInput,
} from '@/services/alerts';
import { getCachedProductBySlug } from '@/services/products';

export async function GET(request: NextRequest) {
  logApiRequest(request, { endpoint: 'alerts' });

  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  try {
    const supabase = await createSupabaseServerClient();
    const alerts = await getAlerts(supabase, auth.userId);

    return apiSuccess(alerts);
  } catch {
    return internalError('Failed to fetch alerts');
  }
}

export async function POST(request: NextRequest) {
  logApiRequest(request, { endpoint: 'alerts.create' });

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
