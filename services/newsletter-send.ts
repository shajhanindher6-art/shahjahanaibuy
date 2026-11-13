/**
 * Newsletter sender (Section 15, P4-4).
 *
 * Sends a digest email to every still-subscribed address in
 * newsletter_subscribers (migration 036) via Resend. The body
 * reuses the digest composer from services/notifications.ts
 * (buildDigestEmail) so the newsletter and the Premium weekly
 * digest never drift apart in wording.
 *
 * FAIL-CLOSED, in order:
 *   1. No RESEND_API_KEY → returns ok:false with
 *      reason 'email-not-configured' without reading the table
 *      or sending anything.
 *   2. Migration 036 unapplied (missing table) → ok:false with
 *      reason 'table-missing'. Nothing is claimed sent.
 *   3. A recipient is counted `sent` ONLY when sendEmail returns
 *      success:true (Resend accepted the send). An unverified
 *      sender is enforced by the provider itself: Resend rejects
 *      the send, sendEmail returns success:false, and the
 *      recipient lands in `failed` — never in `sent`.
 *
 * Recipients are rows with unsubscribed_at IS NULL (still
 * subscribed). Confirmation status is NOT a filter: the capture
 * form never sent a confirmation email before P4-3 (no sender
 * existed), so requiring confirmed_at would mail nobody; every
 * mail carries a one-click unsubscribe link with the row's token.
 * The sender takes a service-role client — subscriber emails are
 * never readable via the anon/authenticated API.
 *
 * Called by POST /api/v1/admin/newsletter/send (Section 16, #31,
 * admin-only). Batch is capped (default 100, max 500 per call) so
 * one run cannot spray the whole list.
 */

import type { AnySupabaseClient } from '@/lib/supabase/types';
import { appConfig } from '@/lib/config/app';
import { logger } from '@/lib/config/logger';
import { isEmailConfigured, sendEmail } from '@/services/email';
import { buildDigestEmail } from '@/services/notifications';
import { isMissingTableError } from '@/lib/newsletter';

export interface NewsletterDigestContent {
  topDeals: unknown[];
  priceDrops: unknown[];
  searchSummary: unknown[];
}

export interface NewsletterSendResult {
  /** False whenever nothing could honestly be reported as sent. */
  ok: boolean;
  /** Present only when ok is false. */
  reason?: 'email-not-configured' | 'table-missing' | 'load-failed' | 'send-failed';
  /** Recipients Resend accepted (sendEmail success:true). */
  sent: number;
  /** Recipients whose send failed (never counted as sent). */
  failed: number;
  /** Still-subscribed recipients considered this run. */
  total: number;
  /** Rows skipped because they already unsubscribed. */
  skippedUnsubscribed: number;
}

export interface NewsletterSendOptions {
  /** Digest content; when omitted, the week's top deals are fetched. */
  content?: NewsletterDigestContent;
  /** Recipients per run (default 100, clamped to 1–500). */
  limit?: number;
  /** Subject line override. */
  subject?: string;
}

const DEFAULT_LIMIT = 100;
/**
 * Sections 21–25, Stage G, G-P2-2 — the per-run recipient cap.
 * The audit found the send limit "unclamped": the route passed
 * the caller's `limit` straight through and this module clamped
 * only with `Math.min(MAX_LIMIT, Math.max(1, ...))`, which lets a
 * non-finite value (`NaN`, from `JSON.parse` of `{"limit": NaN}`
 * — or any non-number that slips past the route's `typeof`
 * check) through as `NaN`, turning the subscriber query into
 * `.limit(NaN)`. The clamp is now explicit and total: only a
 * finite number is honoured, everything else falls back to the
 * default, and the result is always an integer in 1..500. The
 * route (`app/api/v1/admin/newsletter/send/route.ts`) clamps to
 * the same exported maximum before calling, so the bound is
 * enforced at both layers and documented in one place.
 */
export const NEWSLETTER_SEND_MAX_LIMIT = 500;
export const NEWSLETTER_SEND_DEFAULT_LIMIT = DEFAULT_LIMIT;
const MAX_LIMIT = NEWSLETTER_SEND_MAX_LIMIT;

/** Clamp a caller-supplied recipient limit to 1..MAX_LIMIT. */
export function clampNewsletterSendLimit(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_LIMIT;
  }
  return Math.min(MAX_LIMIT, Math.max(1, Math.floor(value)));
}

interface SubscriberRow {
  email: string;
  unsubscribe_token: string;
  unsubscribed_at: string | null;
}

async function fetchTopDeals(supabase: AnySupabaseClient): Promise<unknown[]> {
  try {
    const { data, error } = await supabase
      .from('deals')
      .select('id, title, discount_type, discount_value, end_at')
      .eq('active', true)
      .is('deleted_at', null)
      .order('discount_value', { ascending: false })
      .limit(5);
    if (error || !data) return [];
    return data as unknown[];
  } catch {
    return [];
  }
}

export async function sendNewsletterToSubscribers(
  supabase: AnySupabaseClient,
  options: NewsletterSendOptions = {}
): Promise<NewsletterSendResult> {
  const empty: NewsletterSendResult = {
    ok: false,
    sent: 0,
    failed: 0,
    total: 0,
    skippedUnsubscribed: 0,
  };

  // Fail closed before touching the subscriber table.
  if (!isEmailConfigured()) {
    return { ...empty, reason: 'email-not-configured' };
  }

  const limit = clampNewsletterSendLimit(options.limit ?? DEFAULT_LIMIT);

  let rows: SubscriberRow[];
  try {
    const { data, error } = await supabase
      .from('newsletter_subscribers')
      .select('email, unsubscribe_token, unsubscribed_at')
      .order('created_at', { ascending: true })
      .limit(limit);
    if (error) {
      if (isMissingTableError(error)) {
        return { ...empty, reason: 'table-missing' };
      }
      logger.warn('sendNewsletter: subscriber load failed', { error: error.message });
      return { ...empty, reason: 'load-failed' };
    }
    rows = (data ?? []) as SubscriberRow[];
  } catch (err) {
    logger.warn('sendNewsletter: subscriber load threw', { error: String(err) });
    return { ...empty, reason: 'load-failed' };
  }

  const recipients: SubscriberRow[] = [];
  let skippedUnsubscribed = 0;
  for (const row of rows) {
    if (row.unsubscribed_at) skippedUnsubscribed++;
    else if (row.email) recipients.push(row);
  }

  const content: NewsletterDigestContent = options.content ?? {
    topDeals: await fetchTopDeals(supabase),
    priceDrops: [],
    searchSummary: [],
  };
  const body = buildDigestEmail(content.topDeals, content.priceDrops, content.searchSummary);
  const subject = options.subject ?? `Your Weekly ${appConfig.name} Digest`;

  const result: NewsletterSendResult = {
    ok: true,
    sent: 0,
    failed: 0,
    total: recipients.length,
    skippedUnsubscribed,
  };

  for (const recipient of recipients) {
    const unsubscribeUrl = `${appConfig.url}/api/v1/newsletter/unsubscribe?token=${encodeURIComponent(recipient.unsubscribe_token)}`;
    const text = `${body}\n\nUnsubscribe anytime: ${unsubscribeUrl}`;
    const html = `${body.replace(/\n/g, '<br>')}<br><br><a href="${unsubscribeUrl}">Unsubscribe</a>`;
    try {
      const sent = await sendEmail(
        { to: recipient.email, subject, html, text },
        'weekly_digest'
      );
      // Only a Resend success counts as sent — never claim a
      // delivery the provider did not accept.
      if (sent.success) result.sent++;
      else {
        result.failed++;
        logger.warn('sendNewsletter: send failed', {
          to: recipient.email,
          error: sent.error,
        });
      }
    } catch (err) {
      result.failed++;
      logger.warn('sendNewsletter: send threw', {
        to: recipient.email,
        error: String(err),
      });
    }
  }

  if (result.failed > 0) {
    result.ok = false;
    result.reason = 'send-failed';
  }
  return result;
}
