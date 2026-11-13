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
 * clamped to 1–500 by the sender module (default 100).
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
import { sendNewsletterToSubscribers } from '@/services/newsletter-send';
import { recordAdminAction } from '@/services/admin';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  logApiRequest(request, { endpoint: 'admin.newsletter.send' });
  // Section 19, Phase 9 (§12 #92) — intentionally unwired: sendNewsletterToSubscribers never throws (every failure is a result tuple, audited via recordAdminAction) and its 503s are handled config states, so there is no 5xx to log.
  // Rate limit: 10 requests/min per IP — a send run mails up to
  // 500 people, so this must never be hammerable.
  const limited = await rateLimitResponse(`admin.newsletter.send:${getClientIp(request)}`, 10);
  if (limited) return limited;

  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;

  const service = createSupabaseServiceClient();
  if (!service) {
    return internalError('Newsletter send unavailable (service key missing)');
  }

  let limit: number | undefined;
  try {
    const body = await request.json().catch(() => null);
    if (body && typeof body.limit === 'number') limit = body.limit;
  } catch {
    limit = undefined;
  }

  const result = await sendNewsletterToSubscribers(
    service,
    limit !== undefined ? { limit } : {}
  );

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
