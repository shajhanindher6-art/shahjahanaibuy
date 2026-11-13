/**
 * Newsletter confirm (Section 15, P4-3).
 * GET /api/v1/newsletter/confirm?token=<unsubscribe_token>
 * POST /api/v1/newsletter/confirm { token }
 *
 * Sets confirmed_at on the subscriber row and sends the welcome
 * email via the existing sendWelcomeEmail (services/email.ts) —
 * dead code until now. No migration: the columns + token already
 * exist in migration 036.
 *
 * Fails honestly when 036 is unapplied: a missing table answers
 * 503 "Newsletter signup is not available yet" instead of
 * pretending the confirmation was stored. The welcome email is
 * reported honestly too: `welcomeEmailSent` is true only when
 * Resend accepted the send; when email delivery is not
 * configured the confirmation is still stored and the response
 * says so.
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
import { sendWelcomeEmail } from '@/services/email';
import { logApiError } from '@/lib/api/error-logging';
import { isMissingTableError } from '@/lib/newsletter';
import { validateBody, tokenBodySchema } from '@/lib/api/validation';

export const dynamic = 'force-dynamic';

const GENERIC_MESSAGE =
  'If that newsletter signup existed, it is now confirmed. You will receive deal alerts by email once email delivery is configured.';

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
  // confirm() below does the rest; exactly one check runs per request.
  const limited = await rateLimitResponse(
    `newsletter-confirm:${getClientIp(request)}`,
    30,
    60_000
  );
  if (limited) return limited;
  return confirm(request, null);
}

export async function POST(request: NextRequest) {
  const limited = await rateLimitResponse(
    `newsletter-confirm:${getClientIp(request)}`,
    30,
    60_000
  );
  if (limited) return limited;
  const body = await request.json().catch(() => null);
  // Final 100%, F-P1-60 — schema validation on the POST body only
  // (GET passes null and is unaffected).
  const validation = validateBody(tokenBodySchema, body ?? {});
  // Narrowing check (not invalidBodyResponse — it does not narrow
  // the union, so validation.data would not type-check). Same 400
  // as invalidBodyResponse: the first error, same message.
  if (!validation.success) {
    const firstError = Object.values(validation.errors).flat()[0];
    return badRequest(firstError ?? 'Invalid request body');
  }
  return confirm(request, validation.data);
}

async function confirm(request: NextRequest, body: unknown) {
  logApiRequest(request, { endpoint: 'newsletter.confirm' });

  const token = readToken(request, body);
  if (!token) return badRequest('A confirmation token is required');

  const service = createSupabaseServiceClient();
  if (!service) {
    return internalError('Newsletter service is not configured');
  }

  try {
    const { data, error } = await service
      .from('newsletter_subscribers')
      .select('email, confirmed_at, unsubscribed_at')
      .eq('unsubscribe_token', token)
      .maybeSingle();

    if (error) {
      // Migration 036 not applied yet: fail honestly instead of
      // pretending the confirmation was stored.
      if (isMissingTableError(error)) {
        return serviceUnavailable(
          'Newsletter signup is not available yet — please try again later.'
        );
      }
      return internalError('Could not confirm the newsletter signup');
    }

    // Unknown token: same generic success as a real confirmation
    // (no existence leak). Nothing is stored or sent.
    if (!data) {
      return apiSuccess({
        confirmed: true,
        welcomeEmailSent: false,
        message: GENERIC_MESSAGE,
      });
    }

    const row = data as {
      email: string;
      confirmed_at: string | null;
      unsubscribed_at: string | null;
    };

    // Already unsubscribed: confirming changes nothing, and no
    // welcome email goes to someone who opted out.
    if (row.unsubscribed_at) {
      return apiSuccess({
        confirmed: true,
        welcomeEmailSent: false,
        message: GENERIC_MESSAGE,
      });
    }

    // Already confirmed: idempotent, do not re-send the welcome.
    if (row.confirmed_at) {
      return apiSuccess({
        confirmed: true,
        welcomeEmailSent: false,
        message: 'This newsletter signup was already confirmed.',
      });
    }

    const { error: updateError } = await service
      .from('newsletter_subscribers')
      .update({ confirmed_at: new Date().toISOString() })
      .eq('unsubscribe_token', token);
    if (updateError) {
      if (isMissingTableError(updateError)) {
        return serviceUnavailable(
          'Newsletter signup is not available yet — please try again later.'
        );
      }
      return internalError('Could not confirm the newsletter signup');
    }

    // Welcome email: sent only now that the address is confirmed.
    // sendWelcomeEmail fails closed without RESEND_API_KEY — the
    // confirmation stays stored and the response says so honestly.
    const welcome = await sendWelcomeEmail(row.email);
    if (welcome.success) {
      return apiSuccess({
        confirmed: true,
        welcomeEmailSent: true,
        message: "You're confirmed — a welcome email is on its way.",
      });
    }
    return apiSuccess({
      confirmed: true,
      welcomeEmailSent: false,
      message: "You're confirmed.",
      delivery:
        'Confirmation saved. No welcome email has been sent — sending starts once email delivery is configured.',
    });
  } catch (err) {
    logApiError(err, { request, route: 'newsletter.confirm', status: 500 });
    return internalError('Could not confirm the newsletter signup');
  }
}
