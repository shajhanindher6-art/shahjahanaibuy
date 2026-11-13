/**
 * Newsletter unsubscribe (Section 15, P4-3).
 * GET  /api/v1/newsletter/unsubscribe?token=<unsubscribe_token>
 * POST /api/v1/newsletter/unsubscribe { token }
 *
 * Sets unsubscribed_at on the subscriber row. No migration: the
 * column + token already exist in migration 036 (the guest-alert
 * unsubscribe at /api/v1/alerts/guest/unsubscribe is a separate
 * table and flow). GET exists so the one-click link in a
 * newsletter email works; POST is the API form.
 *
 * Fails honestly when 036 is unapplied: a missing table answers
 * 503 "Newsletter signup is not available yet" instead of
 * pretending the unsubscribe was stored.
 *
 * Token-scoped and idempotent: an unknown token returns the same
 * generic success message as a real one, so the endpoint cannot
 * be used to probe whether an email is subscribed. Uses the
 * service-role client because newsletter_subscribers has NO
 * SELECT/UPDATE policy for anon/authenticated by design (reads
 * only via service-role).
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import {
  apiSuccess,
  badRequest,
  internalError,
  serviceUnavailable,
} from '@/lib/api/responses';
import {
  logApiRequest,
  rateLimitResponse,
  getClientIp,
} from '@/lib/api/middleware';
import { logApiError } from '@/lib/api/error-logging';
import { isMissingTableError } from '@/lib/newsletter';

export const dynamic = 'force-dynamic';

const GENERIC_MESSAGE =
  'If that newsletter signup existed, it is now turned off. You will receive no further newsletter emails.';

function readToken(request: NextRequest, body: unknown): string | null {
  const fromQuery = request.nextUrl.searchParams.get('token');
  if (typeof fromQuery === 'string' && fromQuery.trim() !== '') {
    return fromQuery.trim();
  }
  if (body && typeof body === 'object') {
    const token = (body as { token?: unknown }).token;
    if (typeof token === 'string' && token.trim() !== '') return token.trim();
  }
  return null;
}

export async function GET(request: NextRequest) {
  // Rate limit lives in the handler itself (not the shared helper):
  // tests/rate-limit-coverage.test.ts requires every exported
  // handler to call rateLimitResponse in its own body. The shared
  // unsubscribe() below does the rest; exactly one check runs per request.
  const limited = await rateLimitResponse(
    `newsletter-unsubscribe:${getClientIp(request)}`,
    30,
    60_000
  );
  if (limited) return limited;
  return unsubscribe(request, null);
}

export async function POST(request: NextRequest) {
  const limited = await rateLimitResponse(
    `newsletter-unsubscribe:${getClientIp(request)}`,
    30,
    60_000
  );
  if (limited) return limited;
  const body = await request.json().catch(() => null);
  return unsubscribe(request, body);
}

async function unsubscribe(request: NextRequest, body: unknown) {
  logApiRequest(request, { endpoint: 'newsletter.unsubscribe' });

  const token = readToken(request, body);
  if (!token) return badRequest('An unsubscribe token is required');

  const service = createSupabaseServiceClient();
  if (!service) {
    return internalError('Newsletter service is not configured');
  }

  try {
    const { error } = await service
      .from('newsletter_subscribers')
      .update({ unsubscribed_at: new Date().toISOString() })
      .eq('unsubscribe_token', token);
    if (error) {
      // Migration 036 not applied yet: fail honestly instead of
      // pretending the unsubscribe was stored.
      if (isMissingTableError(error)) {
        return serviceUnavailable(
          'Newsletter signup is not available yet — please try again later.'
        );
      }
      return internalError('Could not unsubscribe right now');
    }
    // Unknown token: same generic success as a real unsubscribe
    // (no existence leak). The update simply matched zero rows.
    return apiSuccess({ unsubscribed: true, message: GENERIC_MESSAGE });
  } catch (err) {
    logApiError(err, { request, route: 'newsletter.unsubscribe', status: 500 });
    return internalError('Could not unsubscribe right now');
  }
}
