/**
 * User preferences service.
 * Manages shopping preferences for personalized recommendations.
 */

import type { AnySupabaseClient } from '@/lib/supabase/types';
import { logger } from '@/lib/config/logger';
import type { UserPreferences } from '@/types/ai';

export interface UpdatePreferencesInput {
  budgetMin?: number | null;
  budgetMax?: number | null;
  favoriteBrands?: string[];
  favoriteCategories?: string[];
  preferredRetailers?: string[];
  notificationEmail?: boolean;
  notificationPush?: boolean;
}

export async function getUserPreferences(
  supabase: AnySupabaseClient,
  userId: string
): Promise<UserPreferences | null> {
  try {
    const { data, error } = await supabase
      .from('user_preferences')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      logger.warn('getUserPreferences: query failed', { error: error.message });
      return null;
    }

    if (!data) return null;
    const row = data as Record<string, unknown>;
    return mapPreferencesRow(row);
  } catch (err) {
    logger.error('getUserPreferences: unexpected error', { error: String(err) });
    return null;
  }
}

export async function upsertUserPreferences(
  supabase: AnySupabaseClient,
  userId: string,
  input: UpdatePreferencesInput
): Promise<UserPreferences | null> {
  try {
    const updateData: Record<string, unknown> = {
      user_id: userId,
      updated_at: new Date().toISOString(),
    };

    if (input.budgetMin !== undefined) updateData.budget_min = input.budgetMin;
    if (input.budgetMax !== undefined) updateData.budget_max = input.budgetMax;
    if (input.favoriteBrands !== undefined) updateData.favorite_brands = input.favoriteBrands;
    if (input.favoriteCategories !== undefined) updateData.favorite_categories = input.favoriteCategories;
    if (input.preferredRetailers !== undefined) updateData.preferred_retailers = input.preferredRetailers;
    if (input.notificationEmail !== undefined) updateData.notification_email = input.notificationEmail;
    if (input.notificationPush !== undefined) updateData.notification_push = input.notificationPush;

    const { data, error } = await supabase
      .from('user_preferences')
      .upsert(updateData, { onConflict: 'user_id' })
      .select('*')
      .maybeSingle();

    if (error || !data) {
      if (error) logger.warn('upsertUserPreferences: failed', { error: error.message });
      return null;
    }

    return mapPreferencesRow(data as Record<string, unknown>);
  } catch (err) {
    logger.error('upsertUserPreferences: unexpected error', { error: String(err) });
    return null;
  }
}

function mapPreferencesRow(row: Record<string, unknown>): UserPreferences {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    budgetMin: row.budget_min ? parseFloat(String(row.budget_min)) : null,
    budgetMax: row.budget_max ? parseFloat(String(row.budget_max)) : null,
    favoriteBrands: (row.favorite_brands as string[]) ?? [],
    favoriteCategories: (row.favorite_categories as string[]) ?? [],
    preferredRetailers: (row.preferred_retailers as string[]) ?? [],
    notificationEmail: row.notification_email as boolean,
    notificationPush: row.notification_push as boolean,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}
