/**
 * User settings data access service.
 */

import type { UserSettings } from '@/types';
import type { AnySupabaseClient } from '@/lib/supabase/types';
import { logger } from '@/lib/config/logger';

export interface UpdateSettingsInput {
  currency?: string;
  language?: string;
  timezone?: string;
  emailNotifications?: boolean;
  pushNotifications?: boolean;
  priceAlerts?: boolean;
}

export async function getUserSettings(
  supabase: AnySupabaseClient,
  userId: string
): Promise<UserSettings | null> {
  // Section 18, item 30 — explicit columns (was select('*')):
  // exactly the fields the mapper below reads.
  const { data, error } = await supabase
    .from('user_settings')
    .select('id, user_id, currency, language, timezone, email_notifications, push_notifications, price_alerts, created_at, updated_at')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to fetch settings: ${error.message}`);
  }

  if (!data) return null;

  return {
    id: data.id,
    userId: data.user_id,
    currency: data.currency,
    language: data.language,
    timezone: data.timezone,
    emailNotifications: data.email_notifications,
    pushNotifications: data.push_notifications,
    priceAlerts: data.price_alerts,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
  };
}

export async function updateUserSettings(
  supabase: AnySupabaseClient,
  userId: string,
  input: UpdateSettingsInput
): Promise<UserSettings | null> {  const updateData: Record<string, unknown> = {};
  if (input.currency !== undefined) updateData.currency = input.currency;
  if (input.language !== undefined) updateData.language = input.language;
  if (input.timezone !== undefined) updateData.timezone = input.timezone;
  if (input.emailNotifications !== undefined)
    updateData.email_notifications = input.emailNotifications;
  if (input.pushNotifications !== undefined)
    updateData.push_notifications = input.pushNotifications;
  if (input.priceAlerts !== undefined) updateData.price_alerts = input.priceAlerts;

  const { data, error } = await supabase
    .from('user_settings')
    .update(updateData)
    .eq('user_id', userId)
    .select('id, user_id, currency, language, timezone, email_notifications, push_notifications, price_alerts, created_at, updated_at')
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to update settings: ${error.message}`);
  }

  return data as UserSettings | null;
}

/**
 * Section 19, Phase 0 (§12 #65) — notification master switches.
 *
 * `user_settings.email_notifications / push_notifications /
 * price_alerts` exist and are editable in settings, but until now
 * nothing in the alert path read them: a user who turned alerts
 * off still got queued + dispatched alerts. These are the only
 * readers the alert path needs — one batched query for every alert
 * owner (the checker), one user at a time (dispatch).
 *
 * Semantics (mirror the migration 001 defaults, all true):
 * - `priceAlerts` is the master switch: false blocks EVERY alert
 *   leg for that user, whatever the channel.
 * - `emailNotifications` / `pushNotifications` block only their
 *   own channel; the other channel still delivers.
 * - No settings row, a read error, or a NULL value means "never
 *   opted out" (defaults: all true) — delivery continues. Only an
 *   explicit `false` opts a user out, so a transient read failure
 *   can never silently drop alerts the user still wants.
 */
export interface AlertDeliverySettings {
  priceAlerts: boolean;
  emailNotifications: boolean;
  pushNotifications: boolean;
}

export const DEFAULT_ALERT_DELIVERY_SETTINGS: AlertDeliverySettings = {
  priceAlerts: true,
  emailNotifications: true,
  pushNotifications: true,
};

export async function getAlertDeliverySettingsByUser(
  supabase: AnySupabaseClient,
  userIds: string[]
): Promise<Map<string, AlertDeliverySettings>> {
  const byUser = new Map<string, AlertDeliverySettings>();
  const ids = [...new Set(userIds.filter(Boolean))];
  if (ids.length === 0) return byUser;

  try {
    const { data, error } = await supabase
      .from('user_settings')
      .select('user_id, email_notifications, push_notifications, price_alerts')
      .in('user_id', ids);

    if (error || !data) {
      if (error) {
        logger.warn('getAlertDeliverySettingsByUser: settings read failed, defaulting to opted-in', {
          error: error.message,
        });
      }
      return byUser;
    }

    for (const row of data as Array<Record<string, unknown>>) {
      const userId = row.user_id as string;
      if (!userId) continue;
      byUser.set(userId, {
        priceAlerts: row.price_alerts !== false,
        emailNotifications: row.email_notifications !== false,
        pushNotifications: row.push_notifications !== false,
      });
    }
  } catch (err) {
    logger.warn('getAlertDeliverySettingsByUser: settings read failed, defaulting to opted-in', {
      error: String(err),
    });
  }

  return byUser;
}
