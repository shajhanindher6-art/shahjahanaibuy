/**
 * Alert history service.
 * Tracks when price alerts were triggered and sent to users.
 */

import type { AnySupabaseClient } from '@/lib/supabase/types';
import { logger } from '@/lib/config/logger';
import type { AlertHistoryEntry } from '@/types/ai';

export async function getAlertHistory(
  supabase: AnySupabaseClient,
  userId: string,
  limit = 20
): Promise<AlertHistoryEntry[]> {
  try {
    const { data, error } = await supabase
      .from('price_alert_history')
      .select('id, alert_id, user_id, product_id, triggered_price, target_price, notification_channel, sent_at')
      .eq('user_id', userId)
      .order('sent_at', { ascending: false })
      .limit(Math.min(100, limit));

    if (error || !data) {
      if (error) logger.warn('getAlertHistory: query failed', { error: error.message });
      return [];
    }

    return (data as Array<Record<string, unknown>>).map((row) => ({
      id: row.id as string,
      alertId: row.alert_id as string,
      userId: row.user_id as string,
      productId: row.product_id as string,
      triggeredPrice: parseFloat(String(row.triggered_price)),
      targetPrice: row.target_price ? parseFloat(String(row.target_price)) : null,
      notificationChannel: row.notification_channel as string,
      sentAt: row.sent_at as string,
    }));
  } catch (err) {
    logger.error('getAlertHistory: unexpected error', { error: String(err) });
    return [];
  }
}

export async function recordAlertTrigger(
  supabase: AnySupabaseClient,
  alertId: string,
  userId: string,
  productId: string,
  triggeredPrice: number,
  targetPrice: number | null,
  notificationChannel: string
): Promise<void> {
  try {
    const { error } = await supabase.from('price_alert_history').insert({
      alert_id: alertId,
      user_id: userId,
      product_id: productId,
      triggered_price: triggeredPrice,
      target_price: targetPrice,
      notification_channel: notificationChannel,
    });

    if (error) logger.warn('recordAlertTrigger: insert failed', { error: error.message });
  } catch (err) {
    logger.error('recordAlertTrigger: unexpected error', { error: String(err) });
  }
}
