/**
 * Adaptive data freshness service.
 *
 * Determines when products should be refreshed based on:
 * - Refresh priority (1=critical → 5=dormant)
 * - View count (popularity)
 * - Active alerts
 * - Price volatility
 * - Time since last refresh
 *
 * The refresh interval is configurable per priority level.
 */

import type { AnySupabaseClient } from '@/lib/supabase/types';
import { logger } from '@/lib/config/logger';

export type RefreshPriority = 1 | 2 | 3 | 4 | 5;
export type RefreshStatus = 'idle' | 'queued' | 'processing' | 'failed';

export interface RefreshPolicy {
  priority: RefreshPriority;
  intervalMs: number;
  label: string;
}

export const REFRESH_POLICIES: Record<RefreshPriority, RefreshPolicy> = {
  1: { priority: 1, intervalMs: 15 * 60 * 1000, label: 'critical' },      // 15 min
  2: { priority: 2, intervalMs: 60 * 60 * 1000, label: 'high' },          // 1 hour
  3: { priority: 3, intervalMs: 6 * 60 * 60 * 1000, label: 'normal' },    // 6 hours
  4: { priority: 4, intervalMs: 24 * 60 * 60 * 1000, label: 'low' },     // 24 hours
  5: { priority: 5, intervalMs: 7 * 24 * 60 * 60 * 1000, label: 'dormant' }, // 7 days
};

export function calculateNextRefresh(
  priority: RefreshPriority,
  viewCount: number = 0,
  hasActiveAlerts: boolean = false
): Date {
  const policy = REFRESH_POLICIES[priority] ?? REFRESH_POLICIES[3];
  let interval = policy.intervalMs;

  // Boost refresh for popular products (more views = more frequent)
  if (viewCount > 1000) interval = Math.floor(interval * 0.5);
  else if (viewCount > 100) interval = Math.floor(interval * 0.75);

  // Boost refresh for products with active alerts
  if (hasActiveAlerts) interval = Math.min(interval, 30 * 60 * 1000); // at most 30 min

  return new Date(Date.now() + interval);
}

export async function getProductsDueForRefresh(
  supabase: AnySupabaseClient,
  limit: number = 50
): Promise<Array<{ id: string; name: string; refreshPriority: number }>> {
  const { data, error } = await supabase
    .from('products')
    .select('id, name, refresh_priority')
    .is('deleted_at', null)
    .lte('next_refresh_at', new Date().toISOString())
    .in('refresh_status', ['idle', 'failed'])
    .order('refresh_priority', { ascending: true })
    .order('next_refresh_at', { ascending: true })
    .limit(limit);

  if (error || !data) return [];
  return data.map((p) => ({
    id: p.id,
    name: p.name,
    refreshPriority: p.refresh_priority,
  }));
}

export async function markProductQueued(
  supabase: AnySupabaseClient,
  productId: string
): Promise<void> {
  await supabase
    .from('products')
    .update({
      refresh_status: 'queued',
    })
    .eq('id', productId);
}

export async function markProductProcessing(
  supabase: AnySupabaseClient,
  productId: string
): Promise<void> {
  await supabase
    .from('products')
    .update({ refresh_status: 'processing' })
    .eq('id', productId);
}

export async function markProductRefreshed(
  supabase: AnySupabaseClient,
  productId: string,
  priority?: RefreshPriority
): Promise<void> {
  const nextRefresh = calculateNextRefresh(priority ?? 3);
  await supabase
    .from('products')
    .update({
      refresh_status: 'idle',
      data_freshness: new Date().toISOString(),
      next_refresh_at: nextRefresh.toISOString(),
    })
    .eq('id', productId);
}

export async function markProductRefreshFailed(
  supabase: AnySupabaseClient,
  productId: string
): Promise<void> {
  const nextRefresh = new Date(Date.now() + 15 * 60 * 1000); // retry in 15 min
  await supabase
    .from('products')
    .update({
      refresh_status: 'failed',
      next_refresh_at: nextRefresh.toISOString(),
    })
    .eq('id', productId);
  logger.warn('Product refresh failed', { productId });
}

export async function updateProductPriority(
  supabase: AnySupabaseClient,
  productId: string,
  priority: RefreshPriority
): Promise<void> {
  const nextRefresh = calculateNextRefresh(priority);
  await supabase
    .from('products')
    .update({
      refresh_priority: priority,
      next_refresh_at: nextRefresh.toISOString(),
    })
    .eq('id', productId);
}

export async function incrementProductViewCount(
  supabase: AnySupabaseClient,
  productId: string
): Promise<void> {
  const { error } = await supabase.rpc('increment_view_count', { product_id: productId });
  if (error) {
    const { data: current } = await supabase
      .from('products')
      .select('view_count')
      .eq('id', productId)
      .maybeSingle();
    const nextCount = (current?.view_count ?? 0) + 1;
    void supabase
      .from('products')
      .update({ view_count: nextCount })
      .eq('id', productId);
  }
}
