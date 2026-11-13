/**
 * API v1 merchant price-accuracy endpoint (Section 5 #7).
 * GET  /api/v1/merchants/[slug]/accuracy — per-retailer accuracy score
 *        from RECORDED audit samples only.
 * POST /api/v1/merchants/[slug]/accuracy — record one audit sample
 *        (admin only, from a real checkout observation).
 *
 * No score exists without samples: an empty audit table returns
 * score null and status "insufficient" ("No audits yet"), never a
 * guessed score. The "Caution" flag needs score < 95% AND ≥ 5
 * samples. Live checkout verification stays manual — this endpoint
 * only records samples the owner/admin enters; it never visits a
 * checkout or fabricates a result.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  apiSuccess,
  badRequest,
  notFound,
  internalError,
  serviceUnavailable,
} from '@/lib/api/responses';
import {
  logApiRequest,
  requireAdmin,
  rateLimitResponse,
  getClientIp,
} from '@/lib/api/middleware';
import { getMerchantBySlug } from '@/services/commerce';
import {
  accuracyScore,
  getAccuracySamples,
  recordAccuracySample,
  ACCURACY_CAUTION_THRESHOLD,
  ACCURACY_MIN_SAMPLES_FOR_CAUTION,
} from '@/lib/price-accuracy';

import { logApiError } from '@/lib/api/error-logging';
export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: { slug: string } }
) {
  logApiRequest(request, { endpoint: 'merchants.accuracy', slug: params.slug });

  const limited = await rateLimitResponse(`merchants-accuracy:${getClientIp(request)}`, 60);
  if (limited) return limited;

  try {
    const supabase = await createSupabaseServerClient();
    const merchant = await getMerchantBySlug(supabase, params.slug);

    if (!merchant) {
      return notFound('Merchant not found');
    }

    const samples = await getAccuracySamples(supabase, merchant.id);
    const result = accuracyScore(samples);

    return apiSuccess({
      merchant: { id: merchant.id, name: merchant.name, slug: merchant.slug },
      score: result.score,
      sampleCount: result.sampleCount,
      matchCount: result.matchCount,
      mismatchCount: result.mismatchCount,
      caution: result.caution,
      status: result.status,
      reasons: result.reasons,
      thresholds: {
        cautionBelow: ACCURACY_CAUTION_THRESHOLD,
        minSamplesForCaution: ACCURACY_MIN_SAMPLES_FOR_CAUTION,
        matchTolerancePct: 1,
      },
      audits: samples.map((s) => ({
        id: s.id,
        productId: s.productId,
        listingPrice: s.listingPrice,
        checkoutPrice: s.checkoutPrice,
        currency: s.currency,
        checkedAt: s.checkedAt,
        sampleSource: s.sampleSource,
        notes: s.notes,
      })),
      note: 'Samples are entered manually by the owner/admin from real checkout observations. No live checkout is verified automatically.',
    });
  } catch (err) {
    logApiError(err, { request, route: 'merchants.accuracy.get', status: 500 });
    return internalError('Failed to fetch merchant accuracy score');
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { slug: string } }
) {
  logApiRequest(request, { endpoint: 'merchants.accuracy.record', slug: params.slug });

  const limited = await rateLimitResponse(
    `merchants-accuracy-record:${getClientIp(request)}`,
    30
  );
  if (limited) return limited;

  const admin = await requireAdmin(request);
  if ('error' in admin) return admin.error;

  try {
    const body = await request.json().catch(() => null);
    const listingPrice = Number(body?.listingPrice);
    const checkoutPrice = Number(body?.checkoutPrice);
    const productId = typeof body?.productId === 'string' ? body.productId : null;
    const currency =
      typeof body?.currency === 'string' && body.currency.trim() !== ''
        ? body.currency.trim().slice(0, 10)
        : 'USD';
    const notes = typeof body?.notes === 'string' ? body.notes.slice(0, 1000) : null;

    if (!Number.isFinite(listingPrice) || listingPrice <= 0) {
      return badRequest('listingPrice must be a positive number');
    }
    if (!Number.isFinite(checkoutPrice) || checkoutPrice <= 0) {
      return badRequest('checkoutPrice must be a positive number');
    }

    const supabase = await createSupabaseServerClient();
    const merchant = await getMerchantBySlug(supabase, params.slug);

    if (!merchant) {
      return notFound('Merchant not found');
    }

    const sample = await recordAccuracySample(supabase, admin.userId, {
      merchantId: merchant.id,
      productId,
      listingPrice,
      checkoutPrice,
      currency,
      notes,
    });

    if (!sample) {
      // Most likely the price_accuracy_audits table does not exist
      // yet (migration 028 not run).
      return serviceUnavailable(
        'Accuracy audits are not available yet — the audit store has not been set up.'
      );
    }

    // Return the updated per-retailer score alongside the new sample.
    const samples = await getAccuracySamples(supabase, merchant.id);
    const result = accuracyScore(samples);

    return apiSuccess({ sample, accuracy: result }, 201);
  } catch (err) {
    logApiError(err, { request, route: 'merchants.accuracy.post', status: 500 });
    return internalError('Failed to record accuracy sample');
  }
}
