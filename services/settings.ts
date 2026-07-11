/**
 * User settings data access service.
 */

import type { UserSettings } from '@/types';
import type { AnySupabaseClient } from '@/lib/supabase/types';

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
  const { data, error } = await supabase
    .from('user_settings')
    .select('*')
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
): Promise<UserSettings | null> {
  const updateData: Record<string, unknown> = {};
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
    .select('*')
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to update settings: ${error.message}`);
  }

  return data as UserSettings | null;
}
