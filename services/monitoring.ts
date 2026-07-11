/**
 * Monitoring service — records and retrieves health metrics for the
 * admin monitoring dashboard.
 *
 * Tracks: provider health, sync history, queue metrics, cache metrics.
 */

import type { AnySupabaseClient } from '@/lib/supabase/types';
import { logger } from '@/lib/config/logger';

// ---------------------------------------------------------------------------
// Provider Health
// ---------------------------------------------------------------------------

export interface ProviderHealthUpdate {
  providerKey: string;
  status?: 'healthy' | 'degraded' | 'down' | 'circuit_open';
  success?: boolean;
  error?: string;
  responseMs?: number;
}

export async function recordProviderHealth(
  supabase: AnySupabaseClient,
  update: ProviderHealthUpdate
): Promise<void> {
  const existing = await supabase
    .from('provider_health')
    .select('*')
    .eq('provider_key', update.providerKey)
    .maybeSingle();

  const now = new Date().toISOString();
  const base: Record<string, unknown> = {
    provider_key: update.providerKey,
    updated_at: now,
  };

  if (update.success !== undefined) {
    if (update.success) {
      base.success_count = (existing.data?.success_count ?? 0) + 1;
      base.consecutive_failures = 0;
      base.last_success_at = now;
    } else {
      base.failure_count = (existing.data?.failure_count ?? 0) + 1;
      base.consecutive_failures = (existing.data?.consecutive_failures ?? 0) + 1;
      base.last_failure_at = now;
      if (update.error) base.last_error = update.error;
    }
  }

  if (update.status) base.status = update.status;
  if (update.responseMs !== undefined) {
    const prevAvg = existing.data?.avg_response_ms ?? update.responseMs;
    base.avg_response_ms = Math.round((prevAvg * 0.9 + update.responseMs * 0.1));
  }

  // Circuit breaker: open after 5 consecutive failures
  if ((base.consecutive_failures as number) >= 5) {
    base.status = 'circuit_open';
    base.circuit_opened_at = now;
  }

  await supabase.from('provider_health').upsert(base, { onConflict: 'provider_key' });
}

export async function getProviderHealth(
  supabase: AnySupabaseClient
): Promise<Array<{ providerKey: string; status: string; successCount: number; failureCount: number; consecutiveFailures: number; lastSuccessAt: string | null; lastFailureAt: string | null; avgResponseMs: number | null }>> {
  const { data } = await supabase
    .from('provider_health')
    .select('*')
    .order('provider_key')
    .limit(100);

  return (data ?? []).map((d) => ({
    providerKey: d.provider_key,
    status: d.status,
    successCount: d.success_count,
    failureCount: d.failure_count,
    consecutiveFailures: d.consecutive_failures,
    lastSuccessAt: d.last_success_at,
    lastFailureAt: d.last_failure_at,
    avgResponseMs: d.avg_response_ms,
  }));
}

// ---------------------------------------------------------------------------
// Sync History
// ---------------------------------------------------------------------------

export interface SyncHistoryEntry {
  providerKey: string;
  syncType: string;
  status: string;
  recordsFetched?: number;
  recordsInserted?: number;
  recordsUpdated?: number;
  recordsRejected?: number;
  errorMessage?: string;
  durationMs?: number;
  dataSourceId?: string;
}

export async function recordSyncHistory(
  supabase: AnySupabaseClient,
  entry: SyncHistoryEntry
): Promise<void> {
  await supabase.from('sync_history').insert({
    data_source_id: entry.dataSourceId ?? null,
    provider_key: entry.providerKey,
    sync_type: entry.syncType,
    status: entry.status,
    records_fetched: entry.recordsFetched ?? 0,
    records_inserted: entry.recordsInserted ?? 0,
    records_updated: entry.recordsUpdated ?? 0,
    records_rejected: entry.recordsRejected ?? 0,
    error_message: entry.errorMessage ?? null,
    duration_ms: entry.durationMs ?? null,
    started_at: new Date(Date.now() - (entry.durationMs ?? 0)).toISOString(),
    completed_at: new Date().toISOString(),
  });
}

export async function getSyncHistory(
  supabase: AnySupabaseClient,
  limit: number = 50
): Promise<Array<{ id: string; providerKey: string; syncType: string; status: string; recordsFetched: number; recordsInserted: number; recordsUpdated: number; recordsRejected: number; errorMessage: string | null; durationMs: number | null; startedAt: string; completedAt: string | null }>> {
  const { data } = await supabase
    .from('sync_history')
    .select('*')
    .order('started_at', { ascending: false })
    .limit(limit);

  return (data ?? []).map((d) => ({
    id: d.id,
    providerKey: d.provider_key,
    syncType: d.sync_type,
    status: d.status,
    recordsFetched: d.records_fetched,
    recordsInserted: d.records_inserted,
    recordsUpdated: d.records_updated,
    recordsRejected: d.records_rejected,
    errorMessage: d.error_message,
    durationMs: d.duration_ms,
    startedAt: d.started_at,
    completedAt: d.completed_at,
  }));
}

// ---------------------------------------------------------------------------
// Queue Metrics
// ---------------------------------------------------------------------------

export interface QueueMetricEntry {
  queueName: string;
  waitingCount: number;
  activeCount: number;
  completedCount: number;
  failedCount: number;
  delayedCount: number;
  throughputPerMin: number;
  avgLatencyMs?: number;
}

export async function recordQueueMetrics(
  supabase: AnySupabaseClient,
  entry: QueueMetricEntry
): Promise<void> {
  await supabase.from('queue_metrics').insert({
    queue_name: entry.queueName,
    metric_type: 'snapshot',
    waiting_count: entry.waitingCount,
    active_count: entry.activeCount,
    completed_count: entry.completedCount,
    failed_count: entry.failedCount,
    delayed_count: entry.delayedCount,
    throughput_per_min: entry.throughputPerMin,
    avg_latency_ms: entry.avgLatencyMs ?? null,
  });
}

export async function getQueueMetrics(
  supabase: AnySupabaseClient,
  limit: number = 50
): Promise<Array<{ queueName: string; waitingCount: number; activeCount: number; completedCount: number; failedCount: number; throughputPerMin: number; avgLatencyMs: number | null; recordedAt: string }>> {
  const { data } = await supabase
    .from('queue_metrics')
    .select('*')
    .order('recorded_at', { ascending: false })
    .limit(limit);

  return (data ?? []).map((d) => ({
    queueName: d.queue_name,
    waitingCount: d.waiting_count,
    activeCount: d.active_count,
    completedCount: d.completed_count,
    failedCount: d.failed_count,
    throughputPerMin: d.throughput_per_min,
    avgLatencyMs: d.avg_latency_ms,
    recordedAt: d.recorded_at,
  }));
}

// ---------------------------------------------------------------------------
// Cache Metrics
// ---------------------------------------------------------------------------

export async function recordCacheMetrics(
  supabase: AnySupabaseClient,
  namespace: string,
  hits: number,
  misses: number,
  evictions: number = 0,
  sizeBytes?: number
): Promise<void> {
  await supabase.from('cache_metrics').insert({
    cache_namespace: namespace,
    hit_count: hits,
    miss_count: misses,
    eviction_count: evictions,
    size_bytes: sizeBytes ?? null,
  });
}

// ---------------------------------------------------------------------------
// Dashboard Summary
// ---------------------------------------------------------------------------

export interface MonitoringSummary {
  providers: Array<{ providerKey: string; status: string; successCount: number; failureCount: number }>;
  recentSyncs: Array<{ id: string; providerKey: string; status: string; recordsFetched: number; startedAt: string }>;
  queueMetrics: Array<{ queueName: string; waitingCount: number; activeCount: number; failedCount: number }>;
  totalProducts: number;
  staleProducts: number;
}

export async function getMonitoringSummary(
  supabase: AnySupabaseClient
): Promise<MonitoringSummary> {
  const [providers, recentSyncs, queueMetrics] = await Promise.all([
    getProviderHealth(supabase),
    getSyncHistory(supabase, 10),
    getQueueMetrics(supabase, 10),
  ]);

  const { count: totalProducts } = await supabase
    .from('products')
    .select('*', { count: 'exact', head: true })
    .is('deleted_at', null);

  const { count: staleProducts } = await supabase
    .from('products')
    .select('*', { count: 'exact', head: true })
    .is('deleted_at', null)
    .lt('next_refresh_at', new Date().toISOString());

  return {
    providers: providers.map((p) => ({
      providerKey: p.providerKey,
      status: p.status,
      successCount: p.successCount,
      failureCount: p.failureCount,
    })),
    recentSyncs: recentSyncs.map((s) => ({
      id: s.id,
      providerKey: s.providerKey,
      status: s.status,
      recordsFetched: s.recordsFetched,
      startedAt: s.startedAt,
    })),
    queueMetrics: queueMetrics.map((q) => ({
      queueName: q.queueName,
      waitingCount: q.waitingCount,
      activeCount: q.activeCount,
      failedCount: q.failedCount,
    })),
    totalProducts: totalProducts ?? 0,
    staleProducts: staleProducts ?? 0,
  };
}
