/**
 * Notification service.
 * Manages email alerts, push notifications, and weekly deal digests.
 */

import type { AnySupabaseClient } from '@/lib/supabase/types';
import { logger } from '@/lib/config/logger';
import {
  getAlertDeliverySettingsByUser,
  DEFAULT_ALERT_DELIVERY_SETTINGS,
} from './settings';

export interface NotificationItem {
  id: string;
  type: string;
  channel: string;
  subject: string | null;
  body: string;
  status: string;
  scheduledFor: string;
  sentAt: string | null;
  createdAt: string;
}

export async function queueNotification(
  supabase: AnySupabaseClient,
  userId: string,
  type: string,
  channel: string,
  subject: string,
  body: string,
  data: Record<string, unknown> | null = null,
  scheduledFor: string | null = null
): Promise<boolean> {
  try {
    const { error } = await supabase.from('notification_queue').insert({
      user_id: userId,
      type,
      channel,
      subject,
      body,
      data: data as Record<string, unknown> | null,
      scheduled_for: scheduledFor ?? new Date().toISOString(),
    });

    if (error) {
      logger.warn('queueNotification: insert failed', { error: error.message });
      return false;
    }

    // In-app inbox record (best effort, never fatal): the dashboard
    // notifications page reads the queue rows, but the dedicated
    // `notifications` table is the durable inbox record that survives
    // the queue row's sent/failed lifecycle. Older databases may not
    // have this table — a failure here must never lose the queued
    // delivery, so it is swallowed silently by design.
    try {
      await supabase.from('notifications').insert({
        user_id: userId,
        type,
        title: subject,
        message: body,
        read: false,
      });
    } catch {
      // Best effort only — the queue row above is the primary record.
    }

    return true;
  } catch (err) {
    logger.error('queueNotification: unexpected error', { error: String(err) });
    return false;
  }
}

export async function getNotifications(
  supabase: AnySupabaseClient,
  userId: string,
  limit = 20
): Promise<NotificationItem[]> {
  try {
    const { data, error } = await supabase
      .from('notification_queue')
      .select('id, type, channel, subject, body, status, scheduled_for, sent_at, created_at')
      .eq('user_id', userId)
      .order('scheduled_for', { ascending: false })
      .limit(Math.min(100, limit));

    if (error || !data) {
      if (error) logger.warn('getNotifications: query failed', { error: error.message });
      return [];
    }

    return (data as Array<Record<string, unknown>>).map((row) => ({
      id: row.id as string,
      type: row.type as string,
      channel: row.channel as string,
      subject: row.subject as string,
      body: row.body as string,
      status: row.status as string,
      scheduledFor: row.scheduled_for as string,
      sentAt: row.sent_at as string | null,
      createdAt: row.created_at as string,
    }));
  } catch (err) {
    logger.error('getNotifications: unexpected error', { error: String(err) });
    return [];
  }
}

/**
 * A past weekly digest, as the read API returns it (Section 15,
 * B12). Digests were write-only until now: generateWeeklyDigest
 * inserts into `weekly_digests` (services/notifications.ts) and
 * nothing ever read them back. The table + RLS already exist
 * (migration 009: `select_own_digests` grants SELECT TO
 * authenticated USING auth.uid() = user_id), so no migration is
 * needed — this is the read side, scoped to the caller's own rows.
 */
export interface PastDigest {
  id: string;
  userId: string;
  weekStart: string;
  weekEnd: string;
  topDeals: unknown[];
  priceDrops: unknown[];
  searchSummary: unknown[];
  sentAt: string | null;
  createdAt: string;
}

/**
 * Past weekly digests for one user, newest week first
 * (Section 15, B12). Returns [] on any failure — including a
 * missing `weekly_digests` table (migration 009 unapplied), in
 * which case no digest could ever have been written either, so
 * an empty list is the honest answer; the failure is logged
 * server-side. The dashboard archive UI is a later worker's
 * (C2 saved searches owns app/dashboard/page.tsx); this is the
 * API + service it will read from.
 */
export async function getPastDigests(
  supabase: AnySupabaseClient,
  userId: string,
  limit = 20
): Promise<PastDigest[]> {
  try {
    const { data, error } = await supabase
      .from('weekly_digests')
      .select('id, user_id, week_start, week_end, top_deals, price_drops, search_summary, sent_at, created_at')
      .eq('user_id', userId)
      .order('week_start', { ascending: false })
      .limit(Math.min(100, Math.max(1, limit)));

    if (error || !data) {
      if (error) logger.warn('getPastDigests: query failed', { error: error.message });
      return [];
    }

    return (data as Array<Record<string, unknown>>).map((row) => ({
      id: row.id as string,
      userId: row.user_id as string,
      weekStart: row.week_start as string,
      weekEnd: row.week_end as string,
      topDeals: (row.top_deals as unknown[]) ?? [],
      priceDrops: (row.price_drops as unknown[]) ?? [],
      searchSummary: (row.search_summary as unknown[]) ?? [],
      sentAt: row.sent_at as string | null,
      createdAt: row.created_at as string,
    }));
  } catch (err) {
    logger.error('getPastDigests: unexpected error', { error: String(err) });
    return [];
  }
}

export async function markNotificationSent(
  supabase: AnySupabaseClient,
  notificationId: string
): Promise<void> {
  try {
    await supabase
      .from('notification_queue')
      .update({ status: 'sent', sent_at: new Date().toISOString() })
      .eq('id', notificationId);
  } catch (err) {
    logger.error('markNotificationSent: failed', { error: String(err) });
  }
}

/**
 * Persist one per-user digest failure (Section 18, item 50;
 * migration 050 adds the `digest_failures` table).
 *
 * The digest endpoint used to count per-user failures in `failed`
 * and log one line, but the failed user_id / reason was stored
 * nowhere — a user whose digest failed every week was invisible
 * after the response body scrolled away. (Contrast: notification
 * dispatch IS persistent — notification_queue status='failed',
 * last_error, retry_count.)
 *
 * Best-effort by design, never throws: when 050 is unapplied the
 * table does not exist and the insert fails (42P01 / PGRST205) —
 * that is logged and the digest continues, because failing the
 * whole digest run over one failure record would lose every other
 * user's digest. Callers must await this (not fire-and-forget) so
 * a test can observe the write, but its failure never changes the
 * caller's return value.
 */
export async function recordDigestFailure(
  supabase: AnySupabaseClient,
  userId: string,
  reason: string
): Promise<void> {
  try {
    const { error } = await supabase
      .from('digest_failures')
      .insert({ user_id: userId, reason });
    if (error) {
      logger.warn('recordDigestFailure: digest failure not persisted', {
        userId,
        error: error.message,
      });
    }
  } catch (err) {
    logger.warn('recordDigestFailure: digest failure not persisted', {
      userId,
      error: String(err),
    });
  }
}

export async function generateWeeklyDigest(
  supabase: AnySupabaseClient,
  userId: string
): Promise<{ topDeals: unknown[]; priceDrops: unknown[]; searchSummary: unknown[] } | null> {
  try {
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data: deals } = await supabase
      .from('deals')
      .select('id, title, discount_type, discount_value, end_at')
      .eq('active', true)
      .is('deleted_at', null)
      .gte('created_at', weekAgo)
      .order('discount_value', { ascending: false })
      .limit(5);

    const { data: alerts } = await supabase
      .from('price_alert_history')
      .select('id, product_id, triggered_price, target_price, sent_at')
      .eq('user_id', userId)
      .gte('sent_at', weekAgo)
      .order('sent_at', { ascending: false })
      .limit(10);

    const { data: searches } = await supabase
      .from('search_history')
      .select('query, results_count, created_at')
      .eq('user_id', userId)
      .gte('created_at', weekAgo)
      .order('created_at', { ascending: false })
      .limit(10);

    const topDeals = deals ?? [];
    const priceDrops = alerts ?? [];
    const searchSummary = searches ?? [];

    const now = new Date();
    const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    // Section 15, P4-2 — CHECK the insert before counting. The old
    // code awaited this insert without looking at `error`: when the
    // digest endpoint ran as the anon-key client, RLS denied the
    // insert (weekly_digests grants INSERT only TO authenticated)
    // and the endpoint still reported `generated: N`. A failed
    // store returns null — the caller must never count it.
    const { error: digestError } = await supabase.from('weekly_digests').insert({
      user_id: userId,
      week_start: weekStart.toISOString().split('T')[0],
      week_end: now.toISOString().split('T')[0],
      top_deals: topDeals,
      price_drops: priceDrops,
      search_summary: searchSummary,
    });
    if (digestError) {
      logger.warn('generateWeeklyDigest: weekly_digests insert failed', {
        userId,
        error: digestError.message,
      });
      // Section 18, item 50: persist the failure — the digest
      // endpoint's `failed` count alone forgets which user failed
      // and why. A missing digest_failures table (050 unapplied)
      // logs and continues; the digest still returns null.
      await recordDigestFailure(
        supabase,
        userId,
        `weekly_digests insert failed: ${digestError.message}`
      );
      return null;
    }

    const digestBody = buildDigestEmail(topDeals, priceDrops, searchSummary);
    // The digest row above IS stored, so a failed queue insert
    // does not un-generate it — but it must be logged, never
    // silently dropped: without the queue row no email is ever
    // sent for this digest.
    const queued = await queueNotification(supabase, userId, 'weekly_digest', 'email', 'Your Weekly SmartBuy AI Digest', digestBody);
    if (!queued) {
      logger.warn('generateWeeklyDigest: digest stored but notification queue insert failed', {
        userId,
      });
    }

    return { topDeals, priceDrops, searchSummary };
  } catch (err) {
    logger.error('generateWeeklyDigest: unexpected error', { error: String(err) });
    // Section 18, item 50: persist the failure (see above).
    await recordDigestFailure(supabase, userId, `unexpected error: ${String(err)}`);
    return null;
  }
}

/**
 * Weekly cadence for the single-scheduler refresh chain
 * (Section 15, P4-2). The refresh runs every 6h, but a digest is
 * weekly: this helper generates one digest per active Premium
 * subscriber only when no digest has been stored in the last 7
 * days, and returns `{ due: false }` otherwise — so the refresh
 * route needs NO second cron job. Callers must use the
 * service-role client: weekly_digests / notification_queue grant
 * INSERT only TO authenticated, and the service client bypasses
 * RLS. Missing digest tables (migration 009 unapplied) are a
 * skip with a recorded reason, not a failure — the same honest
 * empty state the refresh uses for missing guest tables.
 */
export interface WeeklyDigestRunResult {
  /** False when a digest was stored within the last 7 days. */
  due: boolean;
  /** Digests actually stored (insert succeeded). */
  generated: number;
  /** Users whose digest insert failed. */
  failed: number;
  /** Active Premium subscribers considered. */
  total: number;
  /**
   * Sections 21–25, Stage F (F2) — premium subscribers skipped
   * because they turned email off (`email_notifications = false`).
   * Present only when > 0. No settings row / read error means
   * opted-in (fail-open), so only an explicit opt-out skips.
   */
  skippedOptedOut?: number;
  /** Present only when the step was skipped or failed. */
  skipped?: string;
  /** Present only on a non-missing-table load failure. */
  error?: string;
}

/** Active Premium subscriber ids — legacy 'pro' rows included (P2-2). */
export const DIGEST_PLANS = ['premium', 'pro'] as const;

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function isMissingTableError(error: { code?: string } | null | undefined): boolean {
  return error?.code === '42P01' || error?.code === 'PGRST205';
}

export async function generateWeeklyDigestsForPremiumUsers(
  supabase: AnySupabaseClient
): Promise<WeeklyDigestRunResult> {
  const none: WeeklyDigestRunResult = { due: false, generated: 0, failed: 0, total: 0 };
  try {
    // A digest stored within the last 7 days means this week is
    // already covered — the 6-hourly refresh must not re-generate.
    const { data: latest, error: latestError } = await supabase
      .from('weekly_digests')
      .select('created_at')
      .order('created_at', { ascending: false })
      .limit(1);
    if (latestError) {
      if (isMissingTableError(latestError)) {
        return { ...none, skipped: 'weekly_digests table missing (migration 009 not applied)' };
      }
      logger.warn('generateWeeklyDigests: latest-digest check failed', {
        error: latestError.message,
      });
      return { ...none, due: true, error: `latest-digest check failed: ${latestError.message}` };
    }
    const lastCreatedAt = (latest as Array<{ created_at: string }> | null)?.[0]?.created_at;
    if (lastCreatedAt && Date.now() - new Date(lastCreatedAt).getTime() < WEEK_MS) {
      return { ...none, skipped: 'digest stored within the last 7 days' };
    }

    const { data: subs, error: subsError } = await supabase
      .from('subscriptions')
      .select('user_id')
      .in('plan', [...DIGEST_PLANS])
      .eq('status', 'active');
    if (subsError || !subs) {
      if (subsError && isMissingTableError(subsError)) {
        return { ...none, skipped: 'subscriptions table missing' };
      }
      logger.warn('generateWeeklyDigests: subscriptions fetch failed', {
        error: subsError?.message,
      });
      return { ...none, due: true, error: `subscriptions fetch failed: ${subsError?.message ?? 'no rows returned'}` };
    }

    const result: WeeklyDigestRunResult = {
      due: true,
      generated: 0,
      failed: 0,
      total: (subs as Array<{ user_id: string }>).length,
    };
    // Sections 21–25, Stage F (F2) — the digest is an EMAIL: a
    // premium subscriber who turned email off must not get one.
    // The dispatch already refuses the send (channel switch), but
    // generation used to build + store + queue the digest anyway.
    // One batched settings read up front; fail-open (no row / read
    // error = opted-in, same as the checker) so only an explicit
    // opt-out skips. Skipped users are counted, never failed.
    const settingsByUser = await getAlertDeliverySettingsByUser(
      supabase,
      (subs as Array<{ user_id: string }>).map((s) => s.user_id)
    );
    let skippedOptedOut = 0;
    for (const sub of subs as Array<{ user_id: string }>) {
      const settings = settingsByUser.get(sub.user_id) ?? DEFAULT_ALERT_DELIVERY_SETTINGS;
      if (!settings.emailNotifications) {
        skippedOptedOut++;
        continue;
      }
      const digest = await generateWeeklyDigest(supabase, sub.user_id);
      if (digest) result.generated++;
      else result.failed++;
    }
    if (skippedOptedOut > 0) result.skippedOptedOut = skippedOptedOut;
    return result;
  } catch (err) {
    logger.error('generateWeeklyDigests: unexpected error', { error: String(err) });
    return { ...none, due: true, error: String(err) };
  }
}

export function buildDigestEmail(deals: unknown[], priceDrops: unknown[], searches: unknown[]): string {
  const parts: string[] = [];

  parts.push('Here\'s your weekly SmartBuy AI digest!\n');

  if (deals.length > 0) {
    parts.push(`Top Deals This Week (${deals.length}):`);
    for (const deal of deals as Array<Record<string, unknown>>) {
      parts.push(`- ${deal.title}: ${deal.discount_value}${deal.discount_type === 'percentage' ? '% off vs list price' : '$ off vs list price'}`);
    }
    parts.push('');
  }

  if (priceDrops.length > 0) {
    parts.push(`Price Alerts Triggered (${priceDrops.length}):`);
    for (const alert of priceDrops as Array<Record<string, unknown>>) {
      parts.push(`- Price dropped to $${parseFloat(String(alert.triggered_price)).toFixed(2)} (target: $${alert.target_price ? parseFloat(String(alert.target_price)).toFixed(2) : 'N/A'})`);
    }
    parts.push('');
  }

  if (searches.length > 0) {
    parts.push(`Your Recent Searches (${searches.length}):`);
    for (const search of searches as Array<Record<string, unknown>>) {
      parts.push(`- "${search.query}" (${search.results_count} results)`);
    }
  }

  parts.push('\nVisit SmartBuy AI for more great deals and recommendations!');

  return parts.join('\n');
}

export async function trackAnalyticsEvent(
  supabase: AnySupabaseClient,
  eventType: string,
  productId?: string,
  value?: number,
  metadata?: Record<string, unknown>,
  userId?: string
): Promise<void> {
  try {
    await supabase.from('analytics_events').insert({
      event_type: eventType,
      user_id: userId ?? null,
      product_id: productId ?? null,
      value: value ?? null,
      metadata: metadata ?? null,
    });
  } catch (err) {
    logger.warn('trackAnalyticsEvent: insert failed', { error: String(err) });
  }
}
