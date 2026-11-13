/**
 * Admin merchant verification (Section 5 #15).
 * POST /api/v1/admin/merchants/[slug]/verify — admin only.
 *
 * Actions (body.action):
 * - 'record': store policy facts the admin enters (return window,
 *   warranty, reputation score, policy URLs). Only the fields the
 *   admin sends are written — nothing is invented, and no badge is
 *   granted by recording facts alone.
 * - 'verify': record any supplied facts, then check the merged
 *   recorded data against EVERY public Verified Merchant standard
 *   (lib/verified-merchants.ts: price accuracy ≥ 95% across 10+
 *   recorded checkout audits, return ≥ 14 days, warranty ≥ 12
 *   months, trust grade A/B, published policy URL). The badge is
 *   granted ONLY when all five pass, for 90 days
 *   (VERIFIED_MERCHANT_RECHECK_DAYS). When any standard is unmet
 *   the facts are still saved, but the badge is NOT granted and
 *   the response lists exactly which standards are unmet.
 * - 'revoke': remove the badge (clears the 90-day window; the last
 *   verification timestamp is kept as a record).
 *
 * The route never invents a policy value: a missing field counts
 * as unmet, never as a default. When migration 028 has not been
 * run (policy columns missing) the update fails safe with a 503.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import {
  apiSuccess,
  badRequest,
  internalError,
  notFound,
  serviceUnavailable,
} from '@/lib/api/responses';
import {
  logApiRequest,
  requireAdmin,
  rateLimitResponse,
  getClientIp,
} from '@/lib/api/middleware';
import { logApiError } from '@/lib/api/error-logging';
import { checkCsrfOrigin } from '@/lib/api/csrf';
import { recordAdminAction } from '@/services/admin';
import {
  adminMerchantVerifySchema,
  invalidBodyResponse,
  validateBody,
} from '@/lib/api/validation';
import {
  VERIFIED_MERCHANT_RECHECK_DAYS,
  meetsVerifiedMerchantStandards,
} from '@/lib/verified-merchants';
import { accuracyScore, getAccuracySamples } from '@/lib/price-accuracy';
import { computeTrustGrade } from '@/lib/merchant-trust';

export const dynamic = 'force-dynamic';

const POLICY_COLUMNS =
  'id, name, slug, website_url, return_window_days, warranty_months, reputation_score, return_policy_url, warranty_policy_url, policy_verified_at, policy_verified_by, is_verified_merchant, merchant_verified_at, merchant_verified_until';

type PolicyPatch = {
  return_window_days?: number | null;
  warranty_months?: number | null;
  reputation_score?: number | null;
  return_policy_url?: string | null;
  warranty_policy_url?: string | null;
};

function parseOptionalInt(value: unknown, field: string): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
    throw new Error(`${field} must be a whole number of 0 or more`);
  }
  return n;
}

function parseOptionalScore(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 5) {
    throw new Error('reputationScore must be between 0 and 5');
  }
  return n;
}

function parseOptionalUrl(value: unknown, field: string): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string' || value.trim() === '') return null;
  const url = value.trim();
  if (!/^https?:\/\/.+/.test(url)) {
    throw new Error(`${field} must be an http(s) URL`);
  }
  return url;
}

export async function POST(
  request: NextRequest,
  { params }: { params: { slug: string } }
) {
  const startedAt = Date.now();
  logApiRequest(request, { endpoint: 'admin.merchants.verify', slug: params.slug });

  const admin = await requireAdmin(request);
  if ('error' in admin) return admin.error;

  const limited = await rateLimitResponse(`admin-merchants-verify:${admin.userId}`, 30);
  if (limited) return limited;

  // Sections 21–25, Stage G, G-P1-3 — CSRF Origin check
  // (cookie-authed mutation; absent Origin fails open for
  // non-browser clients). The middleware layer checks this too.
  const csrf = checkCsrfOrigin(request);
  if (csrf) return csrf;

  const service = createSupabaseServiceClient();
  if (!service) {
    return internalError('Merchant verification unavailable: service client not configured');
  }

  let body: Record<string, unknown> | null = null;
  try {
    body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  } catch {
    body = null;
  }
  // Sections 21–25, Stage G, G-P2-1 — shared Zod shape gate
  // (type/bounds only; Number() coercion is mirrored by
  // coercibleInt/coercibleNumber). The action enum check and the
  // parseOptional* helpers below are unchanged, so their
  // messages (incl. the http(s) URL rule) are preserved.
  const invalid = invalidBodyResponse(
    validateBody(adminMerchantVerifySchema, body ?? {}),
  );
  if (invalid) return invalid;
  const action = body?.action;
  if (action !== 'record' && action !== 'verify' && action !== 'revoke') {
    return badRequest('action must be one of: record, verify, revoke');
  }

  let patch: PolicyPatch = {};
  try {
    const returnWindowDays = parseOptionalInt(body?.returnWindowDays, 'returnWindowDays');
    const warrantyMonths = parseOptionalInt(body?.warrantyMonths, 'warrantyMonths');
    const reputationScore = parseOptionalScore(body?.reputationScore);
    const returnPolicyUrl = parseOptionalUrl(body?.returnPolicyUrl, 'returnPolicyUrl');
    const warrantyPolicyUrl = parseOptionalUrl(body?.warrantyPolicyUrl, 'warrantyPolicyUrl');
    if (returnWindowDays !== undefined) patch.return_window_days = returnWindowDays;
    if (warrantyMonths !== undefined) patch.warranty_months = warrantyMonths;
    if (reputationScore !== undefined) patch.reputation_score = reputationScore;
    if (returnPolicyUrl !== undefined) patch.return_policy_url = returnPolicyUrl;
    if (warrantyPolicyUrl !== undefined) patch.warranty_policy_url = warrantyPolicyUrl;
  } catch (err) {
    return badRequest(err instanceof Error ? err.message : 'Invalid policy values');
  }

  try {
    const { data: merchant, error: fetchError } = await service
      .from('merchants')
      .select(POLICY_COLUMNS)
      .eq('slug', params.slug)
      .is('deleted_at', null)
      .maybeSingle();

    if (fetchError || !merchant) {
      if (fetchError) {
        return serviceUnavailable(
          'Merchant verification is not available yet — the merchant policy columns (migration 028) may not be set up.'
        );
      }
      return notFound('Merchant not found');
    }

    const row = merchant as Record<string, unknown>;
    const now = new Date();
    const nowIso = now.toISOString();

    if (action === 'revoke') {
      const { data, error } = await service
        .from('merchants')
        .update({ is_verified_merchant: false, merchant_verified_until: null })
        .eq('id', row.id as string)
        .select(POLICY_COLUMNS)
        .single();
      if (error || !data) return internalError('Failed to revoke Verified Merchant status');
      // Section 18, item 14 — audit the mutation. recordAdminAction
      // never throws: a logging failure is recorded by the logger and
      // never fails the admin action itself.
      await recordAdminAction(service, admin.userId, 'merchant_verify_revoke', 'merchant', row.id as string, { slug: params.slug, action: 'revoke' }, getClientIp(request));
      return apiSuccess({ merchant: data, verified: false, unmet: [] });
    }

    // 'record' and 'verify' both store exactly the facts the admin
    // entered (plus the verification stamp for who/when).
    const update: Record<string, unknown> = {
      ...patch,
      policy_verified_at: nowIso,
      policy_verified_by: admin.userId,
    };
    const { data: saved, error: saveError } = await service
      .from('merchants')
      .update(update)
      .eq('id', row.id as string)
      .select(POLICY_COLUMNS)
      .single();
    if (saveError || !saved) {
      return serviceUnavailable(
        'Merchant policy facts could not be saved — the merchant policy columns (migration 028) may not be set up.'
      );
    }
    const savedRow = saved as Record<string, unknown>;

    if (action === 'record') {
      await recordAdminAction(service, admin.userId, 'merchant_verify_record', 'merchant', row.id as string, { slug: params.slug, action: 'record', fields: Object.keys(patch) }, getClientIp(request));
      return apiSuccess({ merchant: saved, verified: false, unmet: [], note: 'Policy facts recorded. No badge was granted — use Verify to check the standards.' });
    }

    // 'verify': check the MERGED recorded data against all five
    // public standards. Missing data counts as unmet.
    const samples = await getAccuracySamples(service, row.id as string, 200);
    const accuracy = accuracyScore(samples);
    const grade = computeTrustGrade({
      returnWindowDays: (savedRow.return_window_days as number | null) ?? null,
      warrantyMonths: (savedRow.warranty_months as number | null) ?? null,
      reputationScore: (savedRow.reputation_score as number | null) ?? null,
    });
    const eligibility = meetsVerifiedMerchantStandards({
      accuracyScore: accuracy.score,
      auditSampleCount: accuracy.sampleCount,
      returnWindowDays: (savedRow.return_window_days as number | null) ?? null,
      warrantyMonths: (savedRow.warranty_months as number | null) ?? null,
      trustGrade: grade.grade,
      hasPolicyUrl:
        typeof savedRow.return_policy_url === 'string' ||
        typeof savedRow.warranty_policy_url === 'string',
    });

    if (!eligibility.eligible) {
      // Facts saved, badge NOT granted — the response says exactly why.
      await recordAdminAction(service, admin.userId, 'merchant_verify_attempt', 'merchant', row.id as string, { slug: params.slug, action: 'verify', verified: false, unmet: eligibility.unmet }, getClientIp(request));
      return apiSuccess({
        merchant: saved,
        verified: false,
        unmet: eligibility.unmet,
        note: 'Policy facts were saved, but the Verified Merchant badge was not granted — one or more public standards are unmet (see unmet).',
      });
    }

    const verifiedUntil = new Date(
      now.getTime() + VERIFIED_MERCHANT_RECHECK_DAYS * 24 * 60 * 60 * 1000
    ).toISOString();
    const { data: verified, error: verifyError } = await service
      .from('merchants')
      .update({
        is_verified_merchant: true,
        merchant_verified_at: nowIso,
        merchant_verified_until: verifiedUntil,
      })
      .eq('id', row.id as string)
      .select(POLICY_COLUMNS)
      .single();
    if (verifyError || !verified) return internalError('Failed to grant Verified Merchant status');
    await recordAdminAction(service, admin.userId, 'merchant_verify_grant', 'merchant', row.id as string, { slug: params.slug, action: 'verify', verified: true, verifiedUntil }, getClientIp(request));
    return apiSuccess({
      merchant: verified,
      verified: true,
      unmet: [],
      note: `Verified Merchant granted for ${VERIFIED_MERCHANT_RECHECK_DAYS} days — re-check is due by ${verifiedUntil.slice(0, 10)}.`,
    });
  } catch (err) {
    // Section 18, Phase 0: previously silent — log + Sentry-capture.
    logApiError(err, {
      request,
      route: 'admin.merchants.verify',
      status: 500,
      startedAt,
      context: { slug: params.slug },
    });
    return internalError('Failed to verify merchant');
  }
}
