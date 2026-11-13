/**
 * Guest email alert unsubscribe (S3#7).
 * GET  /api/v1/alerts/guest/unsubscribe?token=<unsubscribe_token>
 * POST /api/v1/alerts/guest/unsubscribe { token }
 *
 * Token-scoped and idempotent: the token is the unguessable
 * per-alert value mailed with every alert email. An unknown token
 * returns the same success message as a real one, so the endpoint
 * cannot be used to probe whether an email is subscribed. Uses the
 * service-role client because the anon role has no SELECT policy on
 * guest_email_alerts (by design — email addresses are never
 * readable via the API).
 */

import type { NextRequest } from 'next/server';
import { apiSuccess, badRequest, internalError } from '@/lib/api/responses';
import {
  logApiRequest,
  rateLimitResponse,
  getClientIp,
} from '@/lib/api/middleware';
import { logApiError } from '@/lib/api/error-logging';
import { createSupabaseServiceClient } from '@/lib/supabase/service';

const UNCHANGED_MESSAGE =
  'If that email alert existed, it is now turned off. You will receive no further alert emails for it.';

async function unsubscribeByToken(
  token: string
): Promise<{ ok: boolean }> {
  const service = createSupabaseServiceClient();
  if (!service) return { ok: false };
  try {
    const { error } = await service
      .from('guest_email_alerts')
      .update({ active: false, updated_at: new Date().toISOString() })
      .eq('unsubscribe_token', token)
      .eq('active', true);
    if (error) return { ok: false };
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

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
  logApiRequest(request, { endpoint: 'alerts.guest.unsubscribe' });

  const limited = await rateLimitResponse(
    `alerts-guest-unsub:${getClientIp(request)}`,
    30,
    60_000
  );
  if (limited) return limited;

  const token = readToken(request, null);
  if (!token) return badRequest('An unsubscribe token is required');

  const result = await unsubscribeByToken(token);
  if (!result.ok) {
    // Section 19, Phase 9 (§12 #92) — the helper swallows the DB
    // error by design (anti-enumeration: the response must not say
    // whether the token existed), so the failure is logged here
    // with a generic message — never the token — or a DB outage
    // would 500 invisibly.
    logApiError(new Error('guest unsubscribe failed'), {
      request,
      route: 'alerts.guest.unsubscribe',
      status: 500,
    });
    return internalError('Could not unsubscribe right now');
  }
  return apiSuccess({ unsubscribed: true, message: UNCHANGED_MESSAGE });
}

export async function POST(request: NextRequest) {
  logApiRequest(request, { endpoint: 'alerts.guest.unsubscribe' });

  const limited = await rateLimitResponse(
    `alerts-guest-unsub:${getClientIp(request)}`,
    30,
    60_000
  );
  if (limited) return limited;

  const body = await request.json().catch(() => null);
  const token = readToken(request, body);
  if (!token) return badRequest('An unsubscribe token is required');

  const result = await unsubscribeByToken(token);
  if (!result.ok) {
    // Section 19, Phase 9 (§12 #92) — see GET above: log the
    // swallowed DB failure generically (never the token) so a DB
    // outage does not 500 invisibly; the response stays generic.
    logApiError(new Error('guest unsubscribe failed'), {
      request,
      route: 'alerts.guest.unsubscribe',
      status: 500,
    });
    return internalError('Could not unsubscribe right now');
  }
  return apiSuccess({ unsubscribed: true, message: UNCHANGED_MESSAGE });
}
