/**
 * Referral links (S3#10).
 * POST /api/v1/referrals — create (or return the existing) referral
 *   link for this visitor. Signed-in users are keyed by account,
 *   guests by the browser token they send. One link per owner.
 * GET  /api/v1/referrals?code=sb-… — public aggregate stats for one
 *   code (click count only — no owner information of any kind).
 *
 * Clicks themselves are recorded at POST /api/v1/referrals/click,
 * reusing the affiliate-clicks pattern (one row per click + a counter
 * on the link) but in the dedicated referral_clicks table — no IP
 * address or user agent is ever stored (migration 026).
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { appConfig } from '@/lib/config/app';
import {
  apiSuccess,
  badRequest,
  internalError,
} from '@/lib/api/responses';
import {
  logApiRequest,
  rateLimitResponse,
  getClientIp,
  requireAuth,
} from '@/lib/api/middleware';
import {
  buildReferralUrl,
  isValidReferralCode,
} from '@/lib/referral';
import { countReferralSignups } from '@/services/referral-attribution';

import { logApiError } from '@/lib/api/error-logging';
import { validateBody, invalidBodyResponse, referralSchema } from '@/lib/api/validation';
export const dynamic = 'force-dynamic';

function newReferralCode(): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let suffix = '';
  try {
    const bytes = new Uint8Array(10);
    crypto.getRandomValues(bytes);
    for (const b of bytes) suffix += alphabet[b % alphabet.length];
  } catch {
    for (let i = 0; i < 10; i++) {
      suffix += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
  }
  return `sb-${suffix}`;
}

export async function POST(request: NextRequest) {
  logApiRequest(request, { endpoint: 'referrals.create' });

  const limited = await rateLimitResponse(
    `referrals-create:${getClientIp(request)}`,
    30,
    60_000
  );
  if (limited) return limited;

  try {
    const body = await request.json().catch(() => null);
    // Final 100%, F-P1-60 — schema validation (was hand-rolled).
    const validation = validateBody(referralSchema, body ?? {});
    const invalid = invalidBodyResponse(validation);
    if (invalid) return invalid;
    const guestToken =
      body && typeof body.guestToken === 'string' && body.guestToken.trim() !== ''
        ? body.guestToken.trim()
        : null;

    const supabase = await createSupabaseServerClient();

    // Signed-in owner, if any (best effort — no session = guest).
    let userId: string | null = null;
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      userId = user?.id ?? null;
    } catch {
      userId = null;
    }

    if (!userId && !guestToken) {
      return badRequest('A guest token is required for guests');
    }

    // One link per owner: return the existing one if present.
    const ownerQuery = userId
      ? supabase.from('referral_links').select('code, click_count').eq('user_id', userId)
      : supabase.from('referral_links').select('code, click_count').eq('guest_token', guestToken);
    const { data: existing } = await ownerQuery.maybeSingle();
    if (existing) {
      const row = existing as { code: string; click_count: number };
      return apiSuccess({
        code: row.code,
        url: buildReferralUrl(row.code, appConfig.url),
        clicks: row.click_count ?? 0,
      });
    }

    // Create a fresh code (retry once on the astronomically unlikely
    // collision — the code column is UNIQUE).
    for (let attempt = 0; attempt < 2; attempt++) {
      const code = newReferralCode();
      const { error } = await supabase.from('referral_links').insert({
        code,
        user_id: userId,
        guest_token: userId ? null : guestToken,
      });
      if (!error) {
        return apiSuccess(
          { code, url: buildReferralUrl(code, appConfig.url), clicks: 0 },
          201
        );
      }
      if ((error as { code?: string }).code !== '23505') {
        return internalError('Could not create a referral link');
      }
    }
    return internalError('Could not create a referral link');
  } catch (err) {
    logApiError(err, { request, route: 'referrals.post', status: 500 });
    return internalError('Failed to create a referral link');
  }
}

export async function GET(request: NextRequest) {
  logApiRequest(request, { endpoint: 'referrals.stats' });

  const limited = await rateLimitResponse(
    `referrals-stats:${getClientIp(request)}`,
    60,
    60_000
  );
  if (limited) return limited;

  const code = request.nextUrl.searchParams.get('code');

  // Section 15, B13 — the caller's OWN signup count, from real
  // referral_signups rows only (migration 038). Scoped to the
  // authenticated user by construction: the count query filters
  // referrer_user_id = auth.userId, so no other user's signups
  // can ever leak through this mode. `available: false` when
  // migration 038 has not been applied yet — the dashboard card
  // hides the count then instead of showing a guessed 0.
  if (request.nextUrl.searchParams.get('mine') === '1') {
    const auth = await requireAuth(request);
    if ('error' in auth) return auth.error;

    const service = createSupabaseServiceClient();
    if (!service) return internalError('Referral stats unavailable');

    try {
      const { count, available } = await countReferralSignups(service, auth.userId);
      return apiSuccess({ signups: count, available });
    } catch (err) {
      logApiError(err, { request, route: 'referrals.get', status: 500 });
      return internalError('Failed to fetch referral signups');
    }
  }

  if (!isValidReferralCode(code)) {
    return badRequest('A valid referral code is required');
  }

  // Aggregate stats only, via the service client (the anon role has
  // no SELECT policy on referral_links by design).
  const service = createSupabaseServiceClient();
  if (!service) return internalError('Referral stats unavailable');

  try {
    const { data } = await service
      .from('referral_links')
      .select('code, click_count, created_at')
      .eq('code', code)
      .maybeSingle();
    if (!data) return badRequest('Unknown referral code');
    const row = data as { code: string; click_count: number; created_at: string };
    return apiSuccess({
      code: row.code,
      clicks: row.click_count ?? 0,
      createdAt: row.created_at,
    });
  } catch (err) {
    logApiError(err, { request, route: 'referrals.get', status: 500 });
    return internalError('Failed to fetch referral stats');
  }
}
