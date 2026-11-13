/**
 * Newsletter subscribe (Section 12, Chunk D).
 * POST /api/v1/newsletter/subscribe — capture-only email signup.
 *
 * - Public, no sign-in required. Validates the email, stores it in
 *   newsletter_subscribers (migration 036) with its source
 *   (footer/homepage), and answers with the same generic success
 *   message whether the address is new or already subscribed — the
 *   response never leaks whether an email already exists.
 * - CAPTURE ONLY: this route never sends any email. Sending is not
 *   configured (services/email.ts fails closed without
 *   RESEND_API_KEY), so the success message says so honestly:
 *   "sending starts once email delivery is configured".
 * - Storage follows the guest_email_alerts pattern (migration 026):
 *   the anon server client inserts (insert-only RLS policy), and
 *   the unique index on lower(email) dedupes. Migration 036 is
 *   WRITTEN but NOT APPLIED: until the owner applies it, inserts
 *   fail with a missing-table error and this route answers 503
 *   honestly instead of pretending the signup was stored.
 * - Rate-limited per IP (60/minute, same limit as the guided-finder
 *   route) so one client cannot flood signups.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
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
import {
  NEWSLETTER_SUBSCRIBED_MESSAGE,
  isValidEmailAddress,
  normalizeEmail,
  parseNewsletterSource,
  resolveSubscribeInsertResult,
} from '@/lib/newsletter';

import { logApiError } from '@/lib/api/error-logging';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  logApiRequest(request, { endpoint: 'newsletter.subscribe' });

  // Public write endpoint; cap per IP so one client cannot flood it.
  const limited = await rateLimitResponse(
    `newsletter-subscribe:${getClientIp(request)}`,
    60,
    60_000
  );
  if (limited) return limited;

  try {
    const body = await request.json().catch(() => null);
    const { email, source } = body ?? {};

    if (!isValidEmailAddress(email)) {
      return badRequest('A valid email address is required');
    }
    const parsedSource = parseNewsletterSource(source);
    if (!parsedSource.ok) {
      return badRequest(parsedSource.error);
    }

    const normalizedEmail = normalizeEmail(email);

    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.from('newsletter_subscribers').insert({
      email: normalizedEmail,
      source: parsedSource.source,
    });

    const outcome = resolveSubscribeInsertResult(error);
    if (outcome === 'missing-table') {
      // Migration 036 not applied yet: fail honestly instead of
      // pretending the signup was stored.
      return serviceUnavailable(
        'Newsletter signup is not available yet — please try again later.'
      );
    }
    if (outcome === 'error') {
      return internalError('Could not save the newsletter signup');
    }
    // 'subscribed' and 'already-subscribed' get the IDENTICAL
    // response: never leak whether this email was already listed.
    return apiSuccess(
      {
        subscribed: true,
        email: normalizedEmail,
        message: NEWSLETTER_SUBSCRIBED_MESSAGE,
        // Honest delivery note: the address is stored; an email is
        // sent only once email delivery is configured by the owner.
        delivery:
          'Stored. No email has been sent — sending starts once email delivery is configured.',
      },
      201
    );
  } catch (err) {
    logApiError(err, { request, route: 'newsletter.subscribe', status: 500 });
    return internalError('Failed to save the newsletter signup');
  }
}
