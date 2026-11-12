/**
 * API v1 warranty claims (Section 7, item 9 — AI Warranty Claim Helper).
 * GET  /api/v1/tools/warranty-claims — the signed-in user's tracked
 *        claims + their vault items with claim checklists (auth).
 * POST /api/v1/tools/warranty-claims — track a claim for a vault
 *        item (or a product slug), auth required. A claim is a user
 *        record only — no refund, repair or replacement is promised.
 *
 * Fail-safe: if the warranty_claims migration has not been run,
 * GET returns empty lists with claimsEnabled:false and POST
 * answers 503 with an honest message.
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
  getVaultItemsForClaims,
  getWarrantyClaims,
  isValidClaimStatus,
  trackWarrantyClaim,
} from '@/lib/warranty-claim-helper';

export const dynamic = 'force-dynamic';

const MISSING_TABLE_MESSAGE =
  'Warranty claims are not set up yet — the owner still needs to run the Section 7 migration (warranty_claims table) once.';

export async function GET(request: NextRequest) {
  logApiRequest(request, { endpoint: 'tools.warranty-claims' });
  const limited = await rateLimitResponse(`tools.warranty-claims:${getClientIp(request)}`, 30);
  if (limited) return limited;

  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  try {
    const supabase = await createSupabaseServerClient();
    const [{ claims, enabled: claimsEnabled }, { items: vaultItems, enabled: vaultEnabled }] =
      await Promise.all([
        getWarrantyClaims(supabase, auth.userId),
        getVaultItemsForClaims(supabase, auth.userId),
      ]);
    return apiSuccess({ claims, vaultItems }, 200, {
      claimsEnabled,
      vaultEnabled,
    });
  } catch (err) {
    logger.error('[tools.warranty-claims] unexpected error', { error: err instanceof Error ? err.message : err });
    return internalError('Failed to fetch warranty claims');
  }
}

export async function POST(request: NextRequest) {
  logApiRequest(request, { endpoint: 'tools.warranty-claims.track' });
  const limited = await rateLimitResponse(`tools.warranty-claims:${getClientIp(request)}`, 30);
  if (limited) return limited;

  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  try {
    const body = await request.json().catch(() => null);
    const vaultItemId =
      typeof body?.vaultItemId === 'string' && body.vaultItemId.trim() !== ''
        ? body.vaultItemId.trim()
        : null;
    const productSlug =
      typeof body?.productSlug === 'string' && body.productSlug.trim() !== ''
        ? body.productSlug.trim()
        : null;
    if (!vaultItemId && !productSlug) {
      return badRequest('vaultItemId or productSlug is required');
    }
    if (body?.claimStatus !== undefined && body?.claimStatus !== null && !isValidClaimStatus(body.claimStatus)) {
      return badRequest(
        'claimStatus must be one of not_started, in_progress, submitted, resolved, denied.'
      );
    }

    const supabase = await createSupabaseServerClient();
    const result = await trackWarrantyClaim(supabase, auth.userId, {
      vaultItemId,
      productSlug,
      retailer: typeof body?.retailer === 'string' ? body.retailer : null,
      claimStatus: typeof body?.claimStatus === 'string' ? body.claimStatus : null,
      notes: typeof body?.notes === 'string' ? body.notes : null,
    });
    if ('error' in result) {
      if (result.missingTable) return serviceUnavailable(MISSING_TABLE_MESSAGE);
      if (result.notFound) return badRequest(result.error.message);
      // Section 18, Phase 2 — item 55 (audit §1 #75): the lib
      // error text is logged server-side only; the client gets
      // the generic envelope, never a backend message. (The
      // notFound branch above keeps its designed user-facing
      // message — 'Vault item not found' — which carries no
      // backend detail.)
      logApiError(new Error(result.error.message), {
        request,
        route: 'tools.warranty-claims',
        status: 500,
        context: { code: result.error.code ?? null },
      });
      return internalError('Failed to track the warranty claim');
    }
    return apiSuccess({ claim: result.claim, deduped: result.deduped });
  } catch (err) {
    logger.error('[tools.warranty-claims] unexpected error', { error: err instanceof Error ? err.message : err });
    return internalError('Failed to track the warranty claim');
  }
}
