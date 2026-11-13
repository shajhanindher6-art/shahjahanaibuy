/**
 * Admin newsletter send endpoint (Section 16, #31).
 * POST /api/v1/admin/newsletter/send — send the weekly digest to
 * still-subscribed newsletter subscribers.
 *
 * ADMIN-ONLY, FAIL CLOSED: requireAdmin verifies role === 'admin'
 * before anything is read or sent. The send itself runs through
 * services/newsletter-send.ts (sendNewsletterToSubscribers) with
 * the service-role client — subscriber emails are never readable
 * via the anon/authenticated API.
 *
 * Sending stays OWNER-GATED on migration 036 applied +
 * RESEND_API_KEY + a verified sender. When either is missing the
 * route answers 503 with the real reason and sends nothing — it
 * never reports a send that did not happen:
 *   - 'email-not-configured' → 503 "Email sending is not configured yet"
 *   - 'table-missing'        → 503 "Newsletter list is not available yet"
 * A partial send (some recipients failed) returns 200 with the
 * honest counts in the body (ok:false, sent, failed, total) —
 * the caller reads `ok`, never the HTTP status, to know whether
 * every recipient was accepted.
 *
 * Body (optional): { "limit": number } — recipients per run,
 * clamped to 1–NEWSLETTER_SEND_MAX_LIMIT (500) at the route and
 * again in the sender module (default 100).
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import {
  apiSuccess,
  internalError,
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
import {
  clampNewsletterSendLimit,
  sendNewsletterToSubscribers,
} from '@/services/newsletter-send';
import { recordAdminAction } from '@/services/admin';
import {
  adminNewsletterSendSchema,
  invalidBodyResponse,
  validateBody,
} from '@/lib/api/validation';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  logApiRequest(request, { endpoint: 'admin.newsletter.send' });
  // Section 21–25, Stage J, J-P2-3 — wired: an unexpected throw
  // from the sender (it returns result tuples for expected
  // failures, but a throw is still possible) is logged via
  // logApiError. The 503 config states below stay unlogged — they
  // are handled states, not errors.
  // Rate limit: 10 requests/min per IP — a send run mails up to
  // 500 people, so this must never be hammerable.
  const limited = await rateLimitResponse(`admin.newsletter.send:${getClientIp(request)}`, 10);
  if (limited) return limited;

  // Sections 21–25, Stage G, G-P1-3 — CSRF Origin check
  // (cookie-authed mutation; absent Origin fails open for
  // non-browser clients). The middleware layer checks this too.
  const csrf = checkCsrfOrigin(request);
  if (csrf) return csrf;

  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;

  const service = createSupabaseServiceClient();
  if (!service) {
    logApiError(new Error('admin.newsletter.send: service client unavailable'), {
      request,
      route: 'admin.newsletter.send',
      status: 500,
    });
    return internalError('Newsletter send unavailable (service key missing)');
  }

  let limit: number | undefined;
  try {
    const body = await request.json().catch(() => null);
    // Sections 21–25, Stage G, G-P2-1 — shared Zod shape gate
    // (limit must be a finite number when present; the clamp
    // below still floors + bounds it to 1–500 as before).
    const invalid = invalidBodyResponse(
      validateBody(adminNewsletterSendSchema, body ?? {}),
    );
    if (invalid) return invalid;
    // Sections 21–25, Stage G, G-P2-2 — clamp the caller-supplied
    // limit here too, to the documented maximum
    // NEWSLETTER_SEND_MAX_LIMIT (500). The sender module clamps
    // again with the same bound; a non-finite value (NaN) falls
    // back to the default instead of reaching `.limit(NaN)`.
    if (body && typeof body.limit === 'number') limit = clampNewsletterSendLimit(body.limit);
  } catch {
    limit = undefined;
  }

  let result: Awaited<ReturnType<typeof sendNewsletterToSubscribers>>;
  try {
    result = await sendNewsletterToSubscribers(
      service,
      limit !== undefined ? { limit } : {}
    );
  } catch (err) {
    logApiError(err, { request, route: 'admin.newsletter.send', status: 500 });
    return internalError('Newsletter send failed unexpectedly');
  }

  if (!result.ok && result.reason === 'email-not-configured') {
    return serviceUnavailable(
      'Email sending is not configured yet — set RESEND_API_KEY and verify the sender before sending the newsletter.'
    );
  }
  if (!result.ok && result.reason === 'table-missing') {
    return serviceUnavailable(
      'Newsletter list is not available yet — migration 036 (newsletter_subscribers) has not been applied.'
    );
  }

  // Section 18, item 14 — audit the send run (full or partial).
  // 'load-failed' attempted no send, so it is not logged as one.
  // recordAdminAction never throws: a logging failure is recorded
  // by the logger and never fails the response itself.
  if (result.reason !== 'load-failed') {
    await recordAdminAction(
      service,
      auth.userId,
      'newsletter_send',
      'newsletter',
      null,
      {
        sent: result.sent,
        failed: result.failed,
        total: result.total,
        skippedUnsubscribed: result.skippedUnsubscribed,
        ok: result.ok,
        ...(result.reason ? { reason: result.reason } : {}),
      },
      getClientIp(request)
    );
  }

  return apiSuccess(result, 200);
}
