/**
 * API v1 smart home agent (Section 7, item 19 — AI Smart Home
 * Reorder Agent).
 * GET  /api/v1/tools/smart-home — the signed-in user's reorder
 *        rules + pending confirmations (auth).
 * POST /api/v1/tools/smart-home — create a reorder rule (auth).
 *        requires_confirmation is ALWAYS true: every order needs
 *        explicit user confirmation, and the agent never places an
 *        order or charges anything by itself.
 *
 * Fail-safe: if the smart_home_rules migration has not been run,
 * GET returns empty lists with rulesEnabled:false and POST answers
 * 503 with an honest message.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  apiSuccess,
  badRequest,
  internalError,
  serviceUnavailable,
} from '@/lib/api/responses';
import { logger } from '@/lib/config/logger';
import { logApiRequest, requireAuth, rateLimitResponse, getClientIp } from '@/lib/api/middleware';
import { logApiError } from '@/lib/api/error-logging';
import {
  createSmartHomeRule,
  getPendingConfirmations,
  getSmartHomeRules,
  isValidDeviceLabel,
  isValidProductSlug,
  isValidTrigger,
} from '@/lib/smart-home-agent';

export const dynamic = 'force-dynamic';

const MISSING_TABLE_MESSAGE =
  'Smart-home rules are not set up yet — the owner still needs to run the Section 7 migration (smart_home_rules table) once.';

export async function GET(request: NextRequest) {
  logApiRequest(request, { endpoint: 'tools.smart-home' });
  const limited = await rateLimitResponse(`tools.smart-home:${getClientIp(request)}`, 30);
  if (limited) return limited;

  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  try {
    const supabase = await createSupabaseServerClient();
    const [{ rules, enabled: rulesEnabled }, pendingConfirmations] = await Promise.all([
      getSmartHomeRules(supabase, auth.userId),
      getPendingConfirmations(supabase, auth.userId),
    ]);
    return apiSuccess({ rules, pendingConfirmations }, 200, { rulesEnabled });
  } catch (err) {
    logger.error('[tools.smart-home] unexpected error', { error: err instanceof Error ? err.message : err });
    return internalError('Failed to fetch smart-home rules');
  }
}

export async function POST(request: NextRequest) {
  logApiRequest(request, { endpoint: 'tools.smart-home.create' });
  const limited = await rateLimitResponse(`tools.smart-home:${getClientIp(request)}`, 30);
  if (limited) return limited;

  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  try {
    const body = await request.json().catch(() => null);
    if (!isValidDeviceLabel(body?.deviceLabel)) {
      return badRequest('deviceLabel is required (1–100 characters).');
    }
    if (!isValidProductSlug(body?.productSlug)) {
      return badRequest('productSlug is required (lowercase letters, numbers and hyphens).');
    }
    if (!isValidTrigger(body?.trigger)) {
      return badRequest('trigger is required (1–80 characters, letters, numbers, spaces, _ or -).');
    }

    const supabase = await createSupabaseServerClient();
    const result = await createSmartHomeRule(supabase, auth.userId, {
      deviceLabel: body.deviceLabel,
      productSlug: body.productSlug,
      trigger: body.trigger,
      autoOrder: body?.autoOrder === true,
    });
    if ('error' in result) {
      if (result.missingTable) return serviceUnavailable(MISSING_TABLE_MESSAGE);
      // Section 18, Phase 2 — item 55 (audit §1 #75): the lib
      // error text is logged server-side only; the client gets
      // the generic envelope, never a backend message.
      logApiError(new Error(result.error.message), {
        request,
        route: 'tools.smart-home',
        status: 500,
        context: { code: result.error.code ?? null },
      });
      return internalError('Failed to create the smart-home rule');
    }
    return apiSuccess({ rule: result.rule, deduped: result.deduped });
  } catch (err) {
    logger.error('[tools.smart-home] unexpected error', { error: err instanceof Error ? err.message : err });
    return internalError('Failed to create the smart-home rule');
  }
}
