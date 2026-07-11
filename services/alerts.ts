/**
 * Alerts data access service.
 * Reads from and writes to the `alerts` table (migration 006).
 *
 * All functions accept an `AnySupabaseClient` so they work with both the
 * browser (anon, RLS-enforced) and server (service role) clients.
 *
 * Ownership is verified server-side for every update/delete operation by
 * checking that the alert's `user_id` matches the provided `userId`.
 *
 * Database snake_case columns are mapped to camelCase TypeScript properties.
 */

import type { AnySupabaseClient } from '@/lib/supabase/types';
import { logger } from '@/lib/config/logger';
import type { Alert } from '@/types/catalog';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CreateAlertInput {
  productId: string;
  alertType: 'price_drop' | 'back_in_stock' | 'deal';
  conditionValue?: number;
  channel?: 'email' | 'push' | 'both';
}

export interface UpdateAlertInput {
  alertType?: 'price_drop' | 'back_in_stock' | 'deal';
  conditionValue?: number | null;
  channel?: 'email' | 'push' | 'both';
  active?: boolean;
}

// ---------------------------------------------------------------------------
// Row → domain mapper
// ---------------------------------------------------------------------------

interface AlertRow {
  id: string;
  user_id: string;
  product_id: string;
  alert_type: string;
  condition_value: number | string | null;
  channel: string;
  active: boolean;
  last_triggered_at: string | null;
  trigger_count: number;
  created_at: string;
  updated_at: string;
}

function mapAlert(row: AlertRow): Alert {
  return {
    id: row.id,
    userId: row.user_id,
    productId: row.product_id,
    alertType: row.alert_type as Alert['alertType'],
    conditionValue: row.condition_value !== null ? parseFloat(String(row.condition_value)) : null,
    channel: row.channel as Alert['channel'],
    active: row.active,
    lastTriggeredAt: row.last_triggered_at,
    triggerCount: row.trigger_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * List all alerts belonging to a user, ordered by creation date (newest first).
 */
export async function getAlerts(
  supabase: AnySupabaseClient,
  userId: string
): Promise<Alert[]> {
  try {
    const { data, error } = await supabase
      .from('alerts')
      .select('id, user_id, product_id, alert_type, condition_value, channel, active, last_triggered_at, trigger_count, created_at, updated_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error || !data) {
      if (error) logger.warn('getAlerts: query failed', { error: error.message });
      return [];
    }

    return data.map((row) => mapAlert(row as AlertRow));
  } catch (err) {
    logger.error('getAlerts: unexpected error', { error: String(err) });
    return [];
  }
}

/**
 * Create a new alert for a user.
 * @returns The created alert, or `null` on failure.
 */
export async function createAlert(
  supabase: AnySupabaseClient,
  userId: string,
  data: CreateAlertInput
): Promise<Alert | null> {
  try {
    const { data: inserted, error } = await supabase
      .from('alerts')
      .insert({
        user_id: userId,
        product_id: data.productId,
        alert_type: data.alertType,
        condition_value: data.conditionValue ?? null,
        channel: data.channel ?? 'email',
        active: true,
      })
      .select('id, user_id, product_id, alert_type, condition_value, channel, active, last_triggered_at, trigger_count, created_at, updated_at')
      .maybeSingle();

    if (error || !inserted) {
      if (error) logger.warn('createAlert: insert failed', { error: error.message });
      return null;
    }

    return mapAlert(inserted as AlertRow);
  } catch (err) {
    logger.error('createAlert: unexpected error', { error: String(err) });
    return null;
  }
}

/**
 * Update an alert. Verifies that the alert belongs to `userId` before updating.
 *
 * @returns The updated alert, or `null` if not found / not owned / on error.
 */
export async function updateAlert(
  supabase: AnySupabaseClient,
  alertId: string,
  userId: string,
  data: UpdateAlertInput
): Promise<Alert | null> {
  try {
    // Verify ownership
    const { data: existing, error: fetchError } = await supabase
      .from('alerts')
      .select('user_id')
      .eq('id', alertId)
      .maybeSingle();

    if (fetchError || !existing) {
      if (fetchError) logger.warn('updateAlert: ownership check failed', { error: fetchError.message });
      return null;
    }

    if (existing.user_id !== userId) {
      logger.warn('updateAlert: user does not own alert', { alertId, userId });
      return null;
    }

    const updateData: Record<string, unknown> = {};
    if (data.alertType !== undefined) updateData.alert_type = data.alertType;
    if (data.conditionValue !== undefined) updateData.condition_value = data.conditionValue;
    if (data.channel !== undefined) updateData.channel = data.channel;
    if (data.active !== undefined) updateData.active = data.active;

    if (Object.keys(updateData).length === 0) {
      // Nothing to update — return the existing record
      const { data: current } = await supabase
        .from('alerts')
        .select('id, user_id, product_id, alert_type, condition_value, channel, active, last_triggered_at, trigger_count, created_at, updated_at')
        .eq('id', alertId)
        .maybeSingle();
      return current ? mapAlert(current as AlertRow) : null;
    }

    const { data: updated, error } = await supabase
      .from('alerts')
      .update(updateData)
      .eq('id', alertId)
      .select('id, user_id, product_id, alert_type, condition_value, channel, active, last_triggered_at, trigger_count, created_at, updated_at')
      .maybeSingle();

    if (error || !updated) {
      if (error) logger.warn('updateAlert: update failed', { error: error.message });
      return null;
    }

    return mapAlert(updated as AlertRow);
  } catch (err) {
    logger.error('updateAlert: unexpected error', { error: String(err) });
    return null;
  }
}

/**
 * Delete an alert. Verifies ownership before deleting.
 * @returns `true` on success, `false` if not found / not owned / on error.
 */
export async function deleteAlert(
  supabase: AnySupabaseClient,
  alertId: string,
  userId: string
): Promise<boolean> {
  try {
    // Verify ownership
    const { data: existing, error: fetchError } = await supabase
      .from('alerts')
      .select('user_id')
      .eq('id', alertId)
      .maybeSingle();

    if (fetchError || !existing) {
      if (fetchError) logger.warn('deleteAlert: ownership check failed', { error: fetchError.message });
      return false;
    }

    if (existing.user_id !== userId) {
      logger.warn('deleteAlert: user does not own alert', { alertId, userId });
      return false;
    }

    const { error } = await supabase
      .from('alerts')
      .delete()
      .eq('id', alertId);

    if (error) {
      logger.warn('deleteAlert: delete failed', { error: error.message });
      return false;
    }

    return true;
  } catch (err) {
    logger.error('deleteAlert: unexpected error', { error: String(err) });
    return false;
  }
}
