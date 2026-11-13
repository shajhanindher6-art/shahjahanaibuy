/**
 * Admin-only Sentry test endpoint (S4#14).
 * POST /api/v1/admin/sentry-test — send a test event to Sentry.
 *
 * Purpose: verify the Sentry event flow end to end WITHOUT the live
 * site — an admin can trigger a test message/exception and then
 * confirm it in the Sentry dashboard (Issues). This route can only
 * prove the code path ran and Sentry accepted the event (an event
 * ID is returned); it CANNOT confirm dashboard receipt — the owner
 * must look for the event in Sentry (see docs/sentry-triage.md).
 *
 * Body: { kind?: 'message' | 'exception' } (default 'message').
 * - 'message': Sentry.captureMessage('Sentry test message ...').
 * - 'exception': Sentry.captureException(new Error('Sentry test exception ...')).
 *
 * Honest states: no DSN configured (SENTRY_DSN / NEXT_PUBLIC_SENTRY_DSN)
 * → 503, nothing is sent anywhere (the SDK is dormant by design, see
 * sentry.server.config.ts). Never fake a sent event.
 *
 * Admin only (requireAdmin) + 10/min per-user rate limit, same pattern
 * as app/api/v1/admin/visual-search-backfill/route.ts.
 */

import type { NextRequest } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { apiSuccess, badRequest, internalError, serviceUnavailable } from '@/lib/api/responses';
import { logApiRequest, rateLimitResponse, requireAdmin } from '@/lib/api/middleware';
import { logApiError } from '@/lib/api/error-logging';

const TEST_TAG = 'smartbuy-sentry-test';

export async function POST(request: NextRequest) {
  logApiRequest(request, { endpoint: 'admin-sentry-test' });
  const startedAt = Date.now();

  // Section 19, Phase 9 (§12 #92) — outer try/catch: a throw used
  // to be an unlogged Next 500. Only thrown (5xx) errors are
  // logged; the deliberate 503 (no DSN) and 400 (bad kind) below
  // stay unlogged — they are handled states, not server errors.
  try {
    const auth = await requireAdmin(request);
    if ('error' in auth) return auth.error;

    const limited = await rateLimitResponse(`sentry-test:${auth.userId}`, 10);
    if (limited) return limited;

    const dsn = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN;
    if (!dsn) {
      return serviceUnavailable(
        'Sentry DSN is not set (SENTRY_DSN / NEXT_PUBLIC_SENTRY_DSN). The SDK is dormant by design — set the DSN in the hosting dashboard first (see docs/sentry-triage.md).'
      );
    }

    const body = await request.json().catch(() => null);
    const kind = body?.kind ?? 'message';
    if (kind !== 'message' && kind !== 'exception') {
      return badRequest('kind must be "message" or "exception"');
    }

    let eventId: string;
    if (kind === 'exception') {
      eventId = Sentry.captureException(new Error('SmartBuy AI Sentry test exception'), {
        tags: { test: TEST_TAG },
        level: 'error',
      });
    } else {
      eventId = Sentry.captureMessage('SmartBuy AI Sentry test message', {
        tags: { test: TEST_TAG },
        level: 'info',
      });
    }

    // Flush so the event leaves before the serverless function ends.
    await Sentry.flush(2000);

    return apiSuccess(
      {
        sent: true,
        kind,
        eventId,
      },
      200,
      {
        note:
          'Event captured and flushed. Dashboard receipt is NOT confirmed by this response — check Sentry > Issues for the event with tag test=smartbuy-sentry-test (see docs/sentry-triage.md).',
      }
    );
  } catch (err) {
    logApiError(err, { request, route: 'admin-sentry-test', status: 500, startedAt });
    return internalError('Sentry test failed');
  }
}
