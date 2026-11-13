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
import { getMaxAlerts, type TierId } from '@/lib/tiers';
import type { Alert } from '@/types/catalog';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AlertType =
  | 'price_drop'
  | 'back_in_stock'
  | 'deal'
  | 'significant_drop'
  | 'trend'
  | 'opportunity';

export interface CreateAlertInput {
  productId: string;
  alertType: AlertType;
  conditionValue?: number;
  channel?: 'email' | 'push' | 'both';
}

export interface UpdateAlertInput {
  alertType?: AlertType;
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
 * Count a user's alerts (active and inactive — the tier cap counts
 * every stored alert, not just active ones). Returns -1 when the
 * count cannot be determined (DB error); callers treat -1 as
 * "unknown" and fail open (never block a legitimate request on a
 * count failure, same philosophy as lib/api-quota.ts).
 */
export async function countAlerts(
  supabase: AnySupabaseClient,
  userId: string
): Promise<number> {
  try {
    const { count, error } = await supabase
      .from('alerts')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId);

    if (error) {
      logger.warn('countAlerts: count failed', { error: error.message });
      return -1;
    }
    return count ?? 0;
  } catch (err) {
    logger.error('countAlerts: unexpected error', { error: String(err) });
    return -1;
  }
}

export interface AlertCapCheck {
  /** False only when the tier has a cap AND the user is at/over it. */
  allowed: boolean;
  /** Current alert count, or -1 when it could not be determined. */
  current: number;
  /** The tier's cap (`null` = unlimited). */
  max: number | null;
  tier: TierId;
}

/**
 * Count-before-insert cap check (Section 15 B14). Unlimited tiers
 * skip the count entirely. A count failure fails OPEN (allowed,
 * current -1) so a DB hiccup never blocks alert creation.
 */
export async function checkAlertCap(
  supabase: AnySupabaseClient,
  userId: string,
  tierId: TierId
): Promise<AlertCapCheck> {
  const max = getMaxAlerts(tierId);
  if (max === null) {
    return { allowed: true, current: -1, max, tier: tierId };
  }
  const current = await countAlerts(supabase, userId);
  if (current < 0) {
    return { allowed: true, current, max, tier: tierId };
  }
  return {
    allowed: current < max,
    current,
    max,
    tier: tierId,
  };
}

/**
 * Section 19, Phase 6 (§12 #68) — duplicate alert check.
 *
 * Two stored alerts are duplicates when they share user + product
 * + type + trigger (condition_value: same number, or both null)
 * and the existing one is still active. An inactive (deleted /
 * switched-off) twin does NOT block a fresh create — the user
 * deliberately removed it. A different condition_value is a
 * different trigger (e.g. two price_drop alerts at $100 and $80)
 * and is never deduped away.
 *
 * @returns The existing active duplicate, or `null` when none exists.
 */
export async function findDuplicateAlert(
  supabase: AnySupabaseClient,
  userId: string,
  data: CreateAlertInput
): Promise<Alert | null> {
  try {
    const { data: rows, error } = await supabase
      .from('alerts')
      .select('id, user_id, product_id, alert_type, condition_value, channel, active, last_triggered_at, trigger_count, created_at, updated_at')
      .eq('user_id', userId)
      .eq('product_id', data.productId)
      .eq('alert_type', data.alertType)
      .eq('active', true);

    if (error || !rows) {
      if (error) logger.warn('findDuplicateAlert: query failed', { error: error.message });
      return null;
    }

    const wanted =
      data.conditionValue !== undefined && data.conditionValue !== null
        ? data.conditionValue
        : null;
    for (const row of rows as AlertRow[]) {
      const existing =
        row.condition_value !== null && row.condition_value !== undefined
          ? parseFloat(String(row.condition_value))
          : null;
      if (wanted === null && existing === null) return mapAlert(row);
      if (wanted !== null && existing !== null && wanted === existing) {
        return mapAlert(row);
      }
    }
    return null;
  } catch (err) {
    logger.error('findDuplicateAlert: unexpected error', { error: String(err) });
    return null;
  }
}

/**
 * Create a new alert for a user.
 * Idempotent on duplicates (§12 #68): when an identical active
 * alert already exists it is returned as-is and NO second row is
 * inserted, so the same trigger can never fire twice.
 * @returns The created (or already-existing) alert, or `null` on failure.
 */
export async function createAlert(
  supabase: AnySupabaseClient,
  userId: string,
  data: CreateAlertInput
): Promise<Alert | null> {
  const duplicate = await findDuplicateAlert(supabase, userId, data);
  if (duplicate) return duplicate;

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
