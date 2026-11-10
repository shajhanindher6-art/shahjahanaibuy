/**
 * API v1 price-protection endpoint (Section 6, Item 7 — trimmed).
 * GET  /api/v1/price-protection — the signed-in user's watches, with
 *        eligibility DERIVED on view from recorded price_history
 *        (auth required). Eligibility is never stored.
 * POST /api/v1/price-protection — create a watch from one of the
 *        user's Receipt Vault items (auth required). The purchase
 *        price is copied from the vault item's recorded amount; a
 *        vault item with no recorded amount answers 400.
 *
 * A claim is a user-submitted record for review — NO refund is
 * promised and no refund amount is ever stated.
 *
 * Graceful degradation: if migration 033 (or the standalone vault
 * SQL) has not been run yet, GET returns { watches: [],
 * priceProtectionEnabled: false } and POST returns 503 with an
 * honest message.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  apiSuccess,
  badRequest,
  internalError,
  notFound,
  serviceUnavailable,
} from '@/lib/api/responses';
import { logApiRequest, requireAuth, rateLimitResponse, getClientIp } from '@/lib/api/middleware';
import {
  PRICE_PROTECTION_DEFAULT_WINDOW_DAYS,
  createPriceProtectionWatch,
  getPriceProtectionWatches,
  isMissingTableError,
  type VaultItemForWatch,
} from '@/lib/price-protection';

export const dynamic = 'force-dynamic';

const MISSING_TABLE_MESSAGE =
  'Price-drop protection is not set up yet — the owner still needs to run migration 033 (supabase/migrations/20261110130000_033_section6_nextgen.sql) and supabase/add-receipt-vault.sql once.';

export async function GET(request: NextRequest) {
  logApiRequest(request, { endpoint: 'price-protection' });
  // Rate limit: 30 requests/min per IP (see docs/rate-limits.md).
  const limited = await rateLimitResponse(`price-protection:${getClientIp(request)}`, 30);
  if (limited) return limited;

  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  try {
    const supabase = await createSupabaseServerClient();
    const { watches, enabled, error } = await getPriceProtectionWatches(supabase, auth.userId);
    if (error) {
      console.error('[price-protection] fetch error', error);
      return internalError('Failed to fetch protection watches');
    }
    return apiSuccess(watches, 200, { priceProtectionEnabled: enabled });
  } catch (err) {
    console.error('[price-protection] unexpected error', err);
    return internalError('Failed to fetch protection watches');
  }
}

export async function POST(request: NextRequest) {
  logApiRequest(request, { endpoint: 'price-protection.create' });
  // Rate limit: 30 requests/min per IP (see docs/rate-limits.md).
  const limited = await rateLimitResponse(`price-protection:${getClientIp(request)}`, 30);
  if (limited) return limited;

  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  try {
    const body = await request.json().catch(() => null);
    const vaultItemId = typeof body?.vaultItemId === 'string' ? body.vaultItemId.trim() : '';
    if (!vaultItemId) return badRequest('vaultItemId is required');
    const windowDays =
      body?.windowDays === undefined
        ? PRICE_PROTECTION_DEFAULT_WINDOW_DAYS
        : Number(body.windowDays);
    if (!Number.isInteger(windowDays) || windowDays <= 0) {
      return badRequest('windowDays must be a whole number of days greater than 0.');
    }

    const supabase = await createSupabaseServerClient();
    const { data: vaultItem, error: vaultError } = await supabase
      .from('vault_items')
      .select('id, product_id, purchase_date, amount')
      .eq('id', vaultItemId)
      .eq('user_id', auth.userId)
      .maybeSingle();
    if (vaultError) {
      if (isMissingTableError(vaultError)) return serviceUnavailable(MISSING_TABLE_MESSAGE);
      console.error('[price-protection] vault fetch error', vaultError);
      return internalError('Failed to read vault item');
    }
    if (!vaultItem) return notFound('Vault item not found or not owned by user');

    const result = await createPriceProtectionWatch(
      supabase,
      auth.userId,
      vaultItem as VaultItemForWatch,
      windowDays
    );
    if ('error' in result) {
      if (result.missingTable || isMissingTableError(result.error)) {
        return serviceUnavailable(MISSING_TABLE_MESSAGE);
      }
      if (result.noAmount) return badRequest(result.error.message);
      console.error('[price-protection] create error', result.error);
      return internalError('Failed to create protection watch');
    }
    return apiSuccess(result.watch, result.deduped ? 200 : 201, {
      priceProtectionEnabled: true,
    });
  } catch (err) {
    console.error('[price-protection] unexpected error', err);
    return internalError('Failed to create protection watch');
  }
}
