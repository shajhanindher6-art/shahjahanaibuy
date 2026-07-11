/**
 * Notification service.
 * Manages email alerts, push notifications, and weekly deal digests.
 */

import type { AnySupabaseClient } from '@/lib/supabase/types';
import { logger } from '@/lib/config/logger';

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

    await supabase.from('weekly_digests').insert({
      user_id: userId,
      week_start: weekStart.toISOString().split('T')[0],
      week_end: now.toISOString().split('T')[0],
      top_deals: topDeals,
      price_drops: priceDrops,
      search_summary: searchSummary,
    });

    const digestBody = buildDigestEmail(topDeals, priceDrops, searchSummary);
    await queueNotification(supabase, userId, 'weekly_digest', 'email', 'Your Weekly SmartBuy AI Digest', digestBody);

    return { topDeals, priceDrops, searchSummary };
  } catch (err) {
    logger.error('generateWeeklyDigest: unexpected error', { error: String(err) });
    return null;
  }
}

function buildDigestEmail(deals: unknown[], priceDrops: unknown[], searches: unknown[]): string {
  const parts: string[] = [];

  parts.push('Here\'s your weekly SmartBuy AI digest!\n');

  if (deals.length > 0) {
    parts.push(`Top Deals This Week (${deals.length}):`);
    for (const deal of deals as Array<Record<string, unknown>>) {
      parts.push(`- ${deal.title}: ${deal.discount_value}${deal.discount_type === 'percentage' ? '% off' : '$ off'}`);
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
